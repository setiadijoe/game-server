import "dotenv/config";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { ulid } from "ulid";

interface ScoreRecord {
  id: string;
  name: string;
  score: number;
  createdAt: string;
}

interface ScoreStore {
  list(limit: number, cursor?: ScoreCursor): Promise<ScorePage>;
  create(name: string, score: number): Promise<ScoreRecord>;
  close?(): Promise<void>;
}

interface ScoreCursor {
  score: number;
  id: string;
}

interface ScorePage {
  scores: ScoreRecord[];
  nextCursor: string;
}

interface CreateServerOptions {
  frontendRoot?: string;
  scoreStore?: ScoreStore;
}

class RequestError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
  }
}

const FRONTEND_ROOT = path.resolve(__dirname, "../../snake-game");
const MAX_BODY_SIZE = 16 * 1024;
const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

function sendJson(response: http.ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodeCursor(cursor: ScoreCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value: string): ScoreCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid cursor encoding");
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      !isRecord(parsed) ||
      typeof parsed.score !== "number" ||
      !Number.isSafeInteger(parsed.score) ||
      parsed.score < 0 ||
      typeof parsed.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(parsed.id)
    ) {
      throw new Error("Invalid cursor data");
    }
    return { score: parsed.score, id: parsed.id };
  } catch {
    throw new RequestError("Cursor is invalid", 400);
  }
}

interface SupabaseConfig {
  url: string;
  key: string;
}

interface SupabaseScoreRow {
  id: string;
  name: string;
  score: number;
  created_at: string;
}

function isSupabaseScoreRow(value: unknown): value is SupabaseScoreRow {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.score === "number" &&
    Number.isSafeInteger(value.score) &&
    typeof value.created_at === "string" &&
    !Number.isNaN(Date.parse(value.created_at));
}

function createSupabaseScoreStore(config: SupabaseConfig): ScoreStore {
  const projectUrl = new URL(config.url);
  if (projectUrl.protocol !== "https:") {
    throw new Error("SUPABASE_URL must use HTTPS");
  }

  async function request(url: URL, init?: RequestInit): Promise<Response> {
    const response = await fetch(url, {
      ...init,
      headers: {
        apikey: config.key,
        ...init?.headers
      }
    });
    if (!response.ok) {
      throw new Error(`Supabase scores request failed with status ${response.status}: ${await response.text()}`);
    }
    return response;
  }

  async function readRows(response: Response): Promise<SupabaseScoreRow[]> {
    const rows: unknown = await response.json();
    if (!Array.isArray(rows) || !rows.every(isSupabaseScoreRow)) {
      throw new Error("Supabase returned invalid score data");
    }
    return rows;
  }

  return {
    async list(limit, cursor) {
      const url = new URL("/rest/v1/scores", projectUrl);
      url.searchParams.set("select", "id,name,score,created_at");
      url.searchParams.set("order", "score.desc,id.asc");
      url.searchParams.set("limit", String(limit + 1));
      if (cursor) {
        url.searchParams.set(
          "or",
          `(score.lt.${cursor.score},and(score.eq.${cursor.score},id.gt.${cursor.id}))`
        );
      }
      const rows = await readRows(await request(url));
      const hasMore = rows.length > limit;
      const pageRows = rows.slice(0, limit);
      const scores = pageRows.map(({ id, name, score, created_at }) => ({
        id,
        name,
        score,
        createdAt: new Date(created_at).toISOString()
      }));
      const last = pageRows.at(-1);
      return {
        scores,
        nextCursor: hasMore && last ? encodeCursor({ score: last.score, id: last.id }) : ""
      };
    },
    async create(name, score) {
      const url = new URL("/rest/v1/scores", projectUrl);
      url.searchParams.set("select", "id,name,score,created_at");
      const rows = await readRows(await request(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify({ id: ulid(), name, score })
      }));
      const [row] = rows;
      if (!row) throw new Error("Score insert did not return a row");
      return {
        id: row.id,
        name: row.name,
        score: row.score,
        createdAt: new Date(row.created_at).toISOString()
      };
    }
  };
}

async function readRequestBody(request: http.IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_SIZE) {
      throw new RequestError("Request body is too large", 413);
    }
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new RequestError("Request body must be valid JSON", 400);
  }
}

function serveFrontend(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  pathname: string,
  frontendRoot: string
): void {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    sendJson(response, 400, { error: "Invalid URL path" });
    return;
  }

  const requestedPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const filePath = path.resolve(frontendRoot, `.${requestedPath}`);
  if (filePath !== frontendRoot && !filePath.startsWith(`${frontendRoot}${path.sep}`)) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  fs.readFile(filePath, (error, contents) => {
    if (error) {
      if (error.code === "ENOENT" || error.code === "EISDIR") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      console.error("Failed to serve frontend file:", error);
      sendJson(response, 500, { error: "Unable to serve file" });
      return;
    }

    response.writeHead(200, {
      "Content-Type": CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(request.method === "HEAD" ? undefined : contents);
  });
}

function createServer(options: CreateServerOptions = {}): http.Server {
  let scoreStore = options.scoreStore;
  if (!scoreStore) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url) {
      throw new Error("Set SUPABASE_URL before starting the server");
    }
    if (!key) {
      throw new Error(
        "Set SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY before starting the server"
      );
    }
    scoreStore = createSupabaseScoreStore({ url, key });
  }
  const frontendRoot = options.frontendRoot || FRONTEND_ROOT;

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://localhost");
    if (url.pathname === "/api/scores") {
      if (request.method === "GET") {
        const requestedLimit = url.searchParams.get("limit");
        const limit = requestedLimit === null || requestedLimit === "" ? 3 : Number(requestedLimit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          sendJson(response, 400, { error: "Limit must be an integer from 1 to 100" });
          return;
        }
        let cursor: ScoreCursor | undefined;
        const requestedCursor = url.searchParams.get("cursor");
        if (requestedCursor !== null && requestedCursor !== "") {
          try {
            cursor = decodeCursor(requestedCursor);
          } catch (error) {
            if (error instanceof RequestError) {
              sendJson(response, error.statusCode, { error: error.message });
              return;
            }
            throw error;
          }
        }

        try {
          const page = await scoreStore.list(limit, cursor);
          sendJson(response, 200, page);
        } catch (error) {
          console.error("Failed to read score data:", error);
          sendJson(response, 500, { error: "Unable to read scores" });
        }
        return;
      }

      if (request.method === "POST") {
        try {
          const body = await readRequestBody(request);
          if (!isRecord(body)) {
            sendJson(response, 400, { error: "Request body must be a JSON object" });
            return;
          }
          const name = typeof body.name === "string" ? body.name.trim() : "";
          if (name.length < 1 || name.length > 30) {
            sendJson(response, 400, { error: "Name must contain 1 to 30 characters" });
            return;
          }
          if (
            typeof body.score !== "number" ||
            !Number.isSafeInteger(body.score) ||
            body.score < 0
          ) {
            sendJson(response, 400, { error: "Score must be a non-negative integer" });
            return;
          }

          const score = await scoreStore.create(name, body.score);
          sendJson(response, 201, score);
        } catch (error) {
          if (error instanceof RequestError) {
            sendJson(response, error.statusCode, { error: error.message });
            return;
          }
          console.error("Failed to save score:", error);
          sendJson(response, 500, { error: "Unable to save score" });
        }
        return;
      }

      response.setHeader("Allow", "GET, POST");
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    serveFrontend(request, response, url.pathname, frontendRoot);
  });
  server.on("close", () => {
    void scoreStore?.close?.().catch((error: unknown) => {
      console.error("Failed to close database connection:", error);
    });
  });
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }

  createServer().listen(port, "127.0.0.1", () => {
    console.log(`Snake game server running at http://localhost:${port}`);
  });
}

export { createServer };

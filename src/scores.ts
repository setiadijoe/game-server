import * as http from "node:http";
import { ulid } from "ulid";
import type {
  ScoreCursor,
  ScorePage,
  ScoreRecord,
  ScoreStore,
  SupabaseConfig,
  SupabaseScoreRow
} from "./interfaces";
import {
  ALLOWED_GAME_ORIGIN,
  isRecord,
  readRequestBody,
  RequestError,
  sendJson
} from "./api-utils";

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

function isSupabaseScoreRow(value: unknown): value is SupabaseScoreRow {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.score === "number" &&
    Number.isSafeInteger(value.score) &&
    typeof value.created_at === "string" &&
    typeof value.title_game_id === "string" &&
    !Number.isNaN(Date.parse(value.created_at));
}

export class InvalidGameError extends Error {}

export function createSupabaseScoreStore(config: SupabaseConfig): ScoreStore {
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
      throw new Error(
        `Supabase scores request failed with status ${response.status}: ${await response.text()}`
      );
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
    async list(limit, titleGameId, cursor) {
      const url = new URL("/rest/v1/scores", projectUrl);
      url.searchParams.set("select", "id,name,score,created_at,title_game_id");
      url.searchParams.set("title_game_id", `eq.${titleGameId}`);
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
      const scores = pageRows.map(({ id, name, score, created_at, title_game_id }) => ({
        id,
        name,
        score,
        createdAt: new Date(created_at).toISOString(),
        title_game_id
      }));
      const last = pageRows.at(-1);
      return {
        scores,
        nextCursor: hasMore && last ? encodeCursor({ score: last.score, id: last.id }) : ""
      };
    },
    async create(name, score, gameId) {
      const gameUrl = new URL("/rest/v1/title_games", projectUrl);
      gameUrl.searchParams.set("select", "id");
      gameUrl.searchParams.set("id", `eq.${gameId}`);
      gameUrl.searchParams.set("limit", "1");
      const gameResponse = await request(gameUrl);
      const gameRows: unknown = await gameResponse.json();
      if (
        !Array.isArray(gameRows) ||
        gameRows.length !== 1 ||
        !isRecord(gameRows[0]) ||
        gameRows[0].id !== gameId
      ) {
        throw new InvalidGameError("game not invalid");
      }

      const url = new URL("/rest/v1/scores", projectUrl);
      url.searchParams.set("select", "id,name,score,created_at,title_game_id");
      const rows = await readRows(await request(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify({ id: ulid(), name, score, title_game_id: gameId })
      }));
      const [row] = rows;
      if (!row) throw new Error("Score insert did not return a row");
      return {
        id: row.id,
        name: row.name,
        score: row.score,
        createdAt: new Date(row.created_at).toISOString(),
        title_game_id: row.title_game_id
      };
    }
  };
}

export async function handleScoresRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  url: URL,
  scoreStore: ScoreStore
): Promise<void> {
  const isAllowedOrigin = request.headers.origin === ALLOWED_GAME_ORIGIN;
  if (isAllowedOrigin) {
    response.setHeader("Access-Control-Allow-Origin", ALLOWED_GAME_ORIGIN);
    response.setHeader("Vary", "Origin");
  }
  if (request.method === "OPTIONS") {
    if (!isAllowedOrigin) {
      sendJson(response, 403, { error: "Origin not allowed" });
      return;
    }
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET") {
    const titleGameId = url.searchParams.get("title_game_id");
    if (titleGameId === null || titleGameId.trim() === "") {
      sendJson(response, 400, { error: "title_game_id is required" });
      return;
    }

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
      const page: ScorePage = await scoreStore.list(limit, titleGameId, cursor);
      sendJson(response, 200, page);
    } catch (error) {
      console.error("Failed to read score data:", error);
      sendJson(response, 500, { error: "Unable to read scores" });
    }
    return;
  }

  if (request.method === "POST") {
    if (!isAllowedOrigin) {
      sendJson(response, 403, { error: "Origin not allowed" });
      return;
    }
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

      if (typeof body.game_id !== "string" || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(body.game_id)) {
        sendJson(response, 400, { error: "game not invalid" });
        return;
      }

      const score: ScoreRecord = await scoreStore.create(name, body.score, body.game_id);
      sendJson(response, 201, score);
    } catch (error) {
      if (error instanceof RequestError) {
        sendJson(response, error.statusCode, { error: error.message });
        return;
      }
      if (error instanceof InvalidGameError) {
        sendJson(response, 400, { error: error.message });
        return;
      }
      console.error("Failed to save score:", error);
      sendJson(response, 500, { error: "Unable to save score" });
    }
    return;
  }

  response.setHeader("Allow", "GET, POST");
  sendJson(response, 405, { error: "Method not allowed" });
}

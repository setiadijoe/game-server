import "dotenv/config";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import type { CreateServerOptions, ScoreStore, SupabaseConfig, TitleGameStore } from "./interfaces";
import { sendJson } from "./api-utils";
import { createSupabaseScoreStore, handleScoresRequest } from "./scores";
import { createSupabaseTitleGameStore, handleTitleGamesRequest } from "./title-games";

const FRONTEND_ROOT = path.resolve(__dirname, "../../../snake-game");
const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

function getSupabaseConfig(): SupabaseConfig {
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
  return { url, key };
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
  let supabaseConfig: SupabaseConfig | undefined;
  const getConfig = () => supabaseConfig ??= getSupabaseConfig();
  const scoreStore: ScoreStore = options.scoreStore ||
    createSupabaseScoreStore(getConfig());
  const titleGameStore: TitleGameStore = options.titleGameStore ||
    createSupabaseTitleGameStore(getConfig());
  const frontendRoot = options.frontendRoot || FRONTEND_ROOT;

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://localhost");
    if (url.pathname === "/api/scores") {
      await handleScoresRequest(request, response, url, scoreStore);
      return;
    }
    if (url.pathname === "/api/title-games") {
      await handleTitleGamesRequest(request, response, url, titleGameStore);
      return;
    }

    serveFrontend(request, response, url.pathname, frontendRoot);
  });
  server.on("close", () => {
    void scoreStore.close?.().catch((error: unknown) => {
      console.error("Failed to close database connection:", error);
    });
  });
  return server;
}

let vercelServer: http.Server | undefined;

function handler(request: http.IncomingMessage, response: http.ServerResponse): void {
  const pathname = new URL(request.url || "/", "http://localhost").pathname;
  if (pathname !== "/api/scores" && pathname !== "/api/title-games") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  try {
    vercelServer ??= createServer();
    vercelServer.emit("request", request, response);
  } catch (error) {
    console.error("Failed to initialize API:", error);
    sendJson(response, 500, { error: "API configuration error" });
  }
}

export default handler;
export { createServer };

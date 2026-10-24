import * as http from "node:http";
import { ulid } from "ulid";
import type { SupabaseConfig, TitleGameRecord, TitleGameStore } from "./interfaces";
import {
  ALLOWED_GAME_ORIGIN,
  isRecord,
  readRequestBody,
  RequestError,
  sendJson
} from "./api-utils";

export function createSupabaseTitleGameStore(config: SupabaseConfig): TitleGameStore {
  const projectUrl = new URL(config.url);
  if (projectUrl.protocol !== "https:") {
    throw new Error("SUPABASE_URL must use HTTPS");
  }

  return {
    async create(gameName) {
      const url = new URL("/rest/v1/title_games", projectUrl);
      url.searchParams.set("select", "id,created_at,game_name");
      const response = await fetch(url, {
        method: "POST",
        headers: {
          apikey: config.key,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          id: ulid(),
          created_at: new Date().toISOString(),
          game_name: gameName
        })
      });
      if (!response.ok) {
        throw new Error(
          `Supabase title games request failed with status ${response.status}: ${await response.text()}`
        );
      }

      const rows: unknown = await response.json();
      if (
        !Array.isArray(rows) ||
        rows.length !== 1 ||
        !isRecord(rows[0]) ||
        typeof rows[0].id !== "string" ||
        typeof rows[0].game_name !== "string" ||
        typeof rows[0].created_at !== "string" ||
        Number.isNaN(Date.parse(rows[0].created_at))
      ) {
        throw new Error("Supabase returned invalid title game data");
      }

      return {
        id: rows[0].id,
        created_at: new Date(rows[0].created_at).toISOString(),
        game_name: rows[0].game_name
      };
    }
  };
}

export async function handleTitleGamesRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  titleGameStore: TitleGameStore
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
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.writeHead(204);
    response.end();
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
      const gameName = typeof body.game_name === "string" ? body.game_name.trim() : "";
      if (gameName.length === 0) {
        sendJson(response, 400, { error: "game_name must be a non-empty string" });
        return;
      }

      const titleGame: TitleGameRecord = await titleGameStore.create(gameName);
      sendJson(response, 201, titleGame);
    } catch (error) {
      if (error instanceof RequestError) {
        sendJson(response, error.statusCode, { error: error.message });
        return;
      }
      console.error("Failed to save title game:", error);
      sendJson(response, 500, { error: "Unable to save title game" });
    }
    return;
  }

  response.setHeader("Allow", "POST");
  sendJson(response, 405, { error: "Method not allowed" });
}

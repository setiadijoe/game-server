import * as http from "node:http";
import { ulid } from "ulid";
import type {
  SupabaseConfig,
  TitleGameCursor,
  TitleGamePage,
  TitleGameRecord,
  TitleGameStore
} from "./interfaces";
import {
  isRecord,
  isAllowedGameOrigin,
  readRequestBody,
  RequestError,
  sendJson
} from "./api-utils";

function encodeCursor(cursor: TitleGameCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value: string): TitleGameCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid cursor encoding");
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      !isRecord(parsed) ||
      typeof parsed.created_at !== "string" ||
      Number.isNaN(Date.parse(parsed.created_at)) ||
      typeof parsed.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(parsed.id)
    ) {
      throw new Error("Invalid cursor data");
    }
    return { created_at: parsed.created_at, id: parsed.id };
  } catch {
    throw new RequestError("Cursor is invalid", 400);
  }
}

function isTitleGameRow(value: unknown): value is TitleGameRecord {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.game_name === "string" &&
    typeof value.created_at === "string" &&
    !Number.isNaN(Date.parse(value.created_at));
}

export function createSupabaseTitleGameStore(config: SupabaseConfig): TitleGameStore {
  const projectUrl = new URL(config.url);
  if (projectUrl.protocol !== "https:") {
    throw new Error("SUPABASE_URL must use HTTPS");
  }

  return {
    async list(limit, search, cursor) {
      const url = new URL("/rest/v1/title_games", projectUrl);
      url.searchParams.set("select", "id,created_at,game_name");
      url.searchParams.set("order", "created_at.desc,id.asc");
      url.searchParams.set("limit", String(limit + 1));
      if (search) {
        const escapedSearch = search.replace(/[\\%_"]/g, "\\$&");
        url.searchParams.set("game_name", `ilike."%${escapedSearch}%"`);
      }
      if (cursor) {
        url.searchParams.set(
          "or",
          `(created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id}))`
        );
      }

      const response = await fetch(url, {
        headers: { apikey: config.key }
      });
      if (!response.ok) {
        throw new Error(
          `Supabase title games request failed with status ${response.status}: ${await response.text()}`
        );
      }
      const rows: unknown = await response.json();
      if (!Array.isArray(rows) || !rows.every(isTitleGameRow)) {
        throw new Error("Supabase returned invalid title game data");
      }

      const hasMore = rows.length > limit;
      const pageRows = rows.slice(0, limit);
      const games = pageRows.map(({ id, created_at, game_name }) => ({ id, created_at, game_name }));
      const last = pageRows.at(-1);
      return {
        games,
        nextCursor: hasMore && last
          ? encodeCursor({ created_at: last.created_at, id: last.id })
          : ""
      };
    },
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
  url: URL,
  titleGameStore: TitleGameStore
): Promise<void> {
  const origin = request.headers.origin;
  const isAllowedOrigin = isAllowedGameOrigin(origin);
  if (isAllowedOrigin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
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
    const requestedLimit = url.searchParams.get("limit");
    const limit = requestedLimit === null || requestedLimit === "" ? 25 : Number(requestedLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      sendJson(response, 400, { error: "Limit must be an integer from 1 to 100" });
      return;
    }
    const search = url.searchParams.get("search")?.trim() || undefined;
    if (search && search.length > 100) {
      sendJson(response, 400, { error: "Search must be 100 characters or fewer" });
      return;
    }
    let cursor: TitleGameCursor | undefined;
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
      const page: TitleGamePage = await titleGameStore.list(limit, search, cursor);
      sendJson(response, 200, page);
    } catch (error) {
      console.error("Failed to read title games:", error);
      sendJson(response, 500, { error: "Unable to read title games" });
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

  response.setHeader("Allow", "GET, POST");
  sendJson(response, 405, { error: "Method not allowed" });
}

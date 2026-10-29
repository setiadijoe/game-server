import * as http from "node:http";

const ALLOWED_GAME_ORIGINS = new Set([
  "https://snake-game-teal-two.vercel.app",
  "https://tetris-game.vercel.app"
]);
const LOCAL_GAME_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173"
]);
const MAX_BODY_SIZE = 16 * 1024;

export function isAllowedGameOrigin(origin: string | undefined): origin is string {
  if (!origin) return false;
  const configuredOrigins = (process.env.ALLOWED_GAME_ORIGINS ?? "")
    .split(",")
    .map((configuredOrigin) => configuredOrigin.trim())
    .filter(Boolean);
  if (ALLOWED_GAME_ORIGINS.has(origin) || configuredOrigins.includes(origin)) return true;
  const isLocalDevelopment = process.env.NODE_ENV !== "production" && process.env.VERCEL !== "1";
  return isLocalDevelopment && LOCAL_GAME_ORIGINS.has(origin);
}

export class RequestError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
  }
}

export function sendJson(
  response: http.ServerResponse,
  statusCode: number,
  body: unknown
): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readRequestBody(request: http.IncomingMessage): Promise<unknown> {
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

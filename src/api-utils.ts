import * as http from "node:http";

export const ALLOWED_GAME_ORIGIN = "https://snake-game-teal-two.vercel.app";
const MAX_BODY_SIZE = 16 * 1024;

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

import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "../server";

let server: ReturnType<typeof createServer> | undefined;

export default function handler(request: IncomingMessage, response: ServerResponse): void {
  const pathname = new URL(request.url || "/", "http://localhost").pathname;
  if (pathname !== "/api/scores") {
    response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  try {
    server ??= createServer();
    server.emit("request", request, response);
  } catch (error) {
    console.error("Failed to initialize score API:", error);
    response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "Score API configuration error" }));
  }
}

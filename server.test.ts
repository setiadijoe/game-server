import { strict as assert } from "node:assert";
import { createServer as createHttpServer } from "node:http";
import * as path from "node:path";
import { after, before, test } from "node:test";
import handler, { createServer } from "./src/server";

const savedScores: Array<{ id: string; name: string; score: number; createdAt: string }> = [];
const server = createServer({
  frontendRoot: path.resolve(__dirname, "../../snake-game"),
  scoreStore: {
    async list(limit, cursor) {
      const ordered = [...savedScores].sort(
        (left, right) => right.score - left.score || left.id.localeCompare(right.id)
      );
      const remaining = cursor
        ? ordered.filter((entry) =>
          entry.score < cursor.score || (entry.score === cursor.score && entry.id > cursor.id)
        )
        : ordered;
      const page = remaining.slice(0, limit);
      const last = page.at(-1);
      return {
        scores: page,
        nextCursor: remaining.length > limit && last
          ? Buffer.from(JSON.stringify({ score: last.score, id: last.id })).toString("base64url")
          : ""
      };
    },
    async create(name, score) {
      const record = {
        id: `test-${savedScores.length + 1}`,
        name,
        score,
        createdAt: new Date().toISOString()
      };
      savedScores.push(record);
      return record;
    }
  }
});
let baseUrl = "";

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server failed to start");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve())
  );
});

test("exports a request handler for serverless deployments", async () => {
  const handlerServer = createHttpServer(handler);
  await new Promise<void>((resolve) => handlerServer.listen(0, "127.0.0.1", resolve));
  const address = handlerServer.address();
  if (!address || typeof address === "string") throw new Error("Handler server failed to start");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/not-found`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Not found" });
  } finally {
    await new Promise<void>((resolve, reject) =>
      handlerServer.close((error) => error ? reject(error) : resolve())
    );
  }
});

test("creates scores and reads them ordered by score", async () => {
  const firstResponse = await fetch(`${baseUrl}/api/scores`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Player One", score: 20 })
  });
  const first = await firstResponse.json() as { name: string; score: number };
  assert.equal(firstResponse.status, 201);
  assert.equal(first.name, "Player One");
  assert.equal(first.score, 20);

  const secondResponse = await fetch(`${baseUrl}/api/scores`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Player Two", score: 50 })
  });
  assert.equal(secondResponse.status, 201);

  const readResponse = await fetch(`${baseUrl}/api/scores`);
  const page = await readResponse.json() as {
    scores: Array<{ name: string; score: number }>;
    nextCursor: string;
  };
  assert.deepEqual(page.scores.map(({ name, score }) => [name, score]), [
    ["Player Two", 50],
    ["Player One", 20]
  ]);
  assert.equal(page.nextCursor, "");
});

test("defaults empty limit and cursor parameters", async () => {
  const response = await fetch(`${baseUrl}/api/scores?limit=&cursor=`);
  assert.equal(response.status, 200);
  const page = await response.json() as {
    scores: Array<{ name: string; score: number }>;
    nextCursor: string;
  };
  assert.deepEqual(page.scores.map(({ score }) => score), [50, 20]);
  assert.equal(page.nextCursor, "");
});

test("paginates scores with a default page size of three", async () => {
  for (const score of [90, 80, 70, 60]) {
    const response = await fetch(`${baseUrl}/api/scores`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Player ${score}`, score })
    });
    assert.equal(response.status, 201);
  }

  const firstResponse = await fetch(`${baseUrl}/api/scores`);
  const firstPage = await firstResponse.json() as {
    scores: Array<{ name: string; score: number }>;
    nextCursor: string;
  };
  assert.deepEqual(firstPage.scores.map(({ score }) => score), [90, 80, 70]);
  assert.ok(firstPage.nextCursor);

  const secondResponse = await fetch(
    `${baseUrl}/api/scores?cursor=${encodeURIComponent(firstPage.nextCursor)}`
  );
  const secondPage = await secondResponse.json() as {
    scores: Array<{ name: string; score: number }>;
    nextCursor: string;
  };
  assert.deepEqual(secondPage.scores.map(({ score }) => score), [60, 50, 20]);
  assert.equal(secondPage.nextCursor, "");
});

test("rejects invalid score cursors", async () => {
  const response = await fetch(`${baseUrl}/api/scores?cursor=invalid`);
  assert.equal(response.status, 400);
});

test("allows browser CORS preflight for score requests", async () => {
  const response = await fetch(`${baseUrl}/api/scores`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:4173",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type"
    }
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.match(response.headers.get("access-control-allow-methods") || "", /POST/);
});

test("rejects invalid scores and JSON bodies", async () => {
  const response = await fetch(`${baseUrl}/api/scores`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Player", score: -1 })
  });
  assert.equal(response.status, 400);
  assert.match((await response.json() as { error: string }).error, /non-negative integer/);

  const nullBodyResponse = await fetch(`${baseUrl}/api/scores`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "null"
  });
  assert.equal(nullBodyResponse.status, 400);
});

test("serves the existing game frontend", async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<title>Snake \| Pocket Arcade<\/title>/);
});

import { strict as assert } from "node:assert";
import { createServer as createHttpServer } from "node:http";
import * as path from "node:path";
import { after, before, test } from "node:test";
import handler, { createServer } from "./src/server";

const savedScores: Array<{ id: string; name: string; score: number; createdAt: string }> = [];
const savedTitleGames: Array<{ id: string; created_at: string; game_name: string }> = [
  { id: "title-1", created_at: "2026-01-03T00:00:00.000Z", game_name: "Arcade Quest" },
  { id: "title-2", created_at: "2026-01-02T00:00:00.000Z", game_name: "Space Quest" },
  { id: "title-3", created_at: "2026-01-01T00:00:00.000Z", game_name: "Arcade Racer" }
];
const gameOrigin = "https://snake-game-teal-two.vercel.app";
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
  },
  titleGameStore: {
    async list(limit, search, cursor) {
      const matching = savedTitleGames
        .filter((game) => !search || game.game_name.toLowerCase().includes(search.toLowerCase()))
        .sort((left, right) =>
          right.created_at.localeCompare(left.created_at) || left.id.localeCompare(right.id)
        )
        .filter((game) =>
          !cursor ||
          game.created_at < cursor.created_at ||
          (game.created_at === cursor.created_at && game.id > cursor.id)
        );
      const games = matching.slice(0, limit);
      const last = games.at(-1);
      return {
        games,
        nextCursor: matching.length > limit && last
          ? Buffer.from(JSON.stringify({
            created_at: last.created_at,
            id: last.id
          })).toString("base64url")
          : ""
      };
    },
    async create(gameName) {
      const record = {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        created_at: new Date().toISOString(),
        game_name: gameName
      };
      savedTitleGames.push(record);
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
    headers: { "Content-Type": "application/json", Origin: gameOrigin },
    body: JSON.stringify({ name: "Player One", score: 20 })
  });
  const first = await firstResponse.json() as { name: string; score: number };
  assert.equal(firstResponse.status, 201);
  assert.equal(first.name, "Player One");
  assert.equal(first.score, 20);

  const secondResponse = await fetch(`${baseUrl}/api/scores`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: gameOrigin },
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
      headers: { "Content-Type": "application/json", Origin: gameOrigin },
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

test("allows browser CORS preflight from the game origin only", async () => {
  const response = await fetch(`${baseUrl}/api/scores`, {
    method: "OPTIONS",
    headers: {
      Origin: gameOrigin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type"
    }
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), gameOrigin);
  assert.match(response.headers.get("access-control-allow-methods") || "", /POST/);

  const rejectedResponse = await fetch(`${baseUrl}/api/scores`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://example.com",
      "Access-Control-Request-Method": "POST"
    }
  });
  assert.equal(rejectedResponse.status, 403);
});

test("rejects invalid scores and JSON bodies", async () => {
  const response = await fetch(`${baseUrl}/api/scores`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: gameOrigin },
    body: JSON.stringify({ name: "Player", score: -1 })
  });
  assert.equal(response.status, 400);
  assert.match((await response.json() as { error: string }).error, /non-negative integer/);

  const nullBodyResponse = await fetch(`${baseUrl}/api/scores`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: gameOrigin },
    body: "null"
  });
  assert.equal(nullBodyResponse.status, 400);
});

test("rejects score submissions from other or missing origins", async () => {
  for (const origin of ["https://example.com", undefined]) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (origin) headers.Origin = origin;
    const response = await fetch(`${baseUrl}/api/scores`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Player", score: 10 })
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Origin not allowed" });
  }
});

test("creates title games with a ULID and the submitted game name", async () => {
  const response = await fetch(`${baseUrl}/api/title-games`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: gameOrigin },
    body: JSON.stringify({ game_name: "  Space Quest  ", id: "client-controlled" })
  });

  assert.equal(response.status, 201);
  const titleGame = await response.json() as {
    id: string;
    created_at: string;
    game_name: string;
  };
  assert.match(titleGame.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.ok(!Number.isNaN(Date.parse(titleGame.created_at)));
  assert.equal(titleGame.game_name, "Space Quest");
  assert.deepEqual(savedTitleGames.at(-1), titleGame);
});

test("lists title games with case-insensitive search and cursor pagination", async () => {
  const firstResponse = await fetch(`${baseUrl}/api/title-games?search=ARCADE&limit=1`);
  assert.equal(firstResponse.status, 200);
  const firstPage = await firstResponse.json() as {
    games: Array<{ id: string; game_name: string }>;
    nextCursor: string;
  };
  assert.deepEqual(firstPage.games.map(({ game_name }) => game_name), ["Arcade Quest"]);
  assert.ok(firstPage.nextCursor);

  const secondResponse = await fetch(
    `${baseUrl}/api/title-games?search=arcade&limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`
  );
  const secondPage = await secondResponse.json() as {
    games: Array<{ id: string; game_name: string }>;
    nextCursor: string;
  };
  assert.deepEqual(secondPage.games.map(({ game_name }) => game_name), ["Arcade Racer"]);
  assert.equal(secondPage.nextCursor, "");
});

test("allows title-game list CORS preflight for the game origin", async () => {
  const response = await fetch(`${baseUrl}/api/title-games`, {
    method: "OPTIONS",
    headers: {
      Origin: gameOrigin,
      "Access-Control-Request-Method": "GET"
    }
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), gameOrigin);
  assert.match(response.headers.get("access-control-allow-methods") || "", /GET/);
});

test("rejects invalid title-game list parameters", async () => {
  const invalidLimit = await fetch(`${baseUrl}/api/title-games?limit=101`);
  assert.equal(invalidLimit.status, 400);

  const invalidCursor = await fetch(`${baseUrl}/api/title-games?cursor=invalid`);
  assert.equal(invalidCursor.status, 400);

  const longSearch = await fetch(`${baseUrl}/api/title-games?search=${"a".repeat(101)}`);
  assert.equal(longSearch.status, 400);
});

test("rejects empty title game names and disallowed origins", async () => {
  const emptyNameResponse = await fetch(`${baseUrl}/api/title-games`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: gameOrigin },
    body: JSON.stringify({ game_name: "   " })
  });
  assert.equal(emptyNameResponse.status, 400);

  const rejectedOriginResponse = await fetch(`${baseUrl}/api/title-games`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://example.com" },
    body: JSON.stringify({ game_name: "Space Quest" })
  });
  assert.equal(rejectedOriginResponse.status, 403);
});

test("serves the existing game frontend", async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<title>Snake \| Pocket Arcade<\/title>/);
});

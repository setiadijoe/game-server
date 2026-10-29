# Game Server

This server hosts the game in `../snake-game` and stores completed game scores
in the Supabase `scores` table through the Supabase REST API. The server is
written in TypeScript.

## Run

```sh
cd game-server
npm install
cp .env.example .env
# Set SUPABASE_URL and SUPABASE_SECRET_KEY from your Supabase project
npm start
```

Open [http://localhost:3000](http://localhost:3000). When a game ends, enter a
name to save that run's score. The high-score list is loaded from the server.
Keep `SUPABASE_SECRET_KEY` private in `.env`; it grants privileged server-side
access and must never be put in the browser. The server also accepts the legacy
`SUPABASE_SERVICE_ROLE_KEY` variable.

The `scores` table should contain `id` (varchar), `name` (varchar), `score`
(int4), `created_at` (timestamp with time zone, default `now()`), and the
required `title_game_id` (varchar). The server generates `id` as a ULID and
leaves `created_at` to the database default. Run
`sql/backfill-scores-title-game-id.sql` once to add `title_game_id` and assign
the existing score rows to the Snake Game ULID, then enforce `NOT NULL`. Future
score submissions must provide a valid game ID. Use the project URL shown in
Supabase for `SUPABASE_URL`; requests use HTTPS.

The `title_games` table should contain `id` (varchar), `game_name` (varchar),
and `created_at` (timestamp with time zone). The server generates `id` as a
ULID and sets `created_at` when inserting a game name.
Run the DDL in `sql/title-games-indexes.sql` in the Supabase SQL Editor to add
the trigram search index and cursor-ordering index.
Run `sql/20261028-1421-scores-title-game-id-index.sql` in the Supabase SQL Editor to add an
index used to filter scores by `title_game_id`.
If `GET /api/title-games` returns a permission error, run
`sql/grant-title-games-select.sql` in the Supabase SQL Editor to allow the
server's `service_role` to read title games.

## API

The OpenAPI/Swagger specification is in [`openapi.yaml`](./openapi.yaml). Open
it with Swagger Editor or Swagger UI to browse and try the endpoints.

- `GET /api/scores` requires `title_game_id` and returns that game's top 3 scores
  by default and a `nextCursor`. Pass the game ID as `?title_game_id=...`.
  Pass a non-empty cursor as `?cursor=...` to get the next page; an empty
  cursor starts from the first page. `nextCursor` is an empty string when there
  are no more results. Use `?limit=25` to request up to 100 scores per page;
  an omitted or empty limit defaults to 3.
- `POST /api/scores` creates a score. Send JSON such as
  `{"name":"Player 1","score":120,"game_id":"01ARZ3NDEKTSV4RRFFQ69G5FAV"}`.
  The game ID must identify an existing title game; otherwise the API returns
  `400` with `{"error":"game not invalid"}`. The game UI looks up “Snake Game”
  and sends its ID with the score.
- `POST /api/title-games` stores a game name. Send JSON such as
  `{"game_name":"Space Quest"}`. The server trims the name and returns the
  inserted record with its generated ULID and timestamp.
- `GET /api/title-games` lists title games by newest first. It returns `games`
  and a `nextCursor`; pass a non-empty cursor as `?cursor=...` for the next
  page. Use `?search=space` for case-insensitive substring search and
  `?limit=25` for page size (defaults to 25; maximum 100).

Score player names must contain 1–30 characters after trimming, and scores must
be non-negative integers. Game names must contain at least one non-whitespace
character. Score and title-game submissions and browser CORS requests are
accepted only from `https://snake-game-teal-two.vercel.app` and
`https://tetris-game.vercel.app`. Local Tetris development origins
(`http://localhost:5173` and `http://127.0.0.1:5173`) are accepted only when
running outside production and Vercel. The server responds with `201 Created`
and the saved record.

The origin check limits browser-based cross-origin submissions; it is not
authentication, because non-browser clients can forge the `Origin` header.

Set `PORT` to change the default port. Run `npm test` to compile the TypeScript
and test the API.

## Deploy to Vercel

Deploy this directory as the Vercel project root. Add `SUPABASE_URL` and
`SUPABASE_SECRET_KEY` to the Vercel project's environment variables for each
deployment environment, then redeploy. The `api/scores.ts` and `api/title-games.ts` functions serve
their respective endpoints and handle browser CORS preflight requests.

Leave Vercel's Output Directory unset so it detects the `api/` function.
The API files are Vercel function entry points; the reusable server
implementation is kept in `src/server.ts` so Vercel does not detect it as a
separate function. The local HTTP server still starts with `npm start`.
# game-server

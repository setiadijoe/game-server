CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS title_games_game_name_trgm_idx
  ON public.title_games USING gin (game_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS title_games_created_at_id_idx
  ON public.title_games (created_at DESC, id ASC);

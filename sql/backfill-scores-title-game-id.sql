BEGIN;

ALTER TABLE public.scores
  ADD COLUMN title_game_id varchar;

UPDATE public.scores
SET title_game_id = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
WHERE title_game_id IS NULL;

ALTER TABLE public.scores
  ALTER COLUMN title_game_id SET NOT NULL;

COMMIT;

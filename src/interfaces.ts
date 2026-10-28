export interface ScoreRecord {
  id: string;
  name: string;
  score: number;
  createdAt: string;
  title_game_id: string;
}

export interface ScoreStore {
  list(limit: number, titleGameId: string, cursor?: ScoreCursor): Promise<ScorePage>;
  create(name: string, score: number, gameId: string): Promise<ScoreRecord>;
  close?(): Promise<void>;
}

export interface TitleGameRecord {
  id: string;
  created_at: string;
  game_name: string;
}

export interface TitleGameStore {
  list(limit: number, search?: string, cursor?: TitleGameCursor): Promise<TitleGamePage>;
  create(gameName: string): Promise<TitleGameRecord>;
}

export interface TitleGameCursor {
  created_at: string;
  id: string;
}

export interface TitleGamePage {
  games: TitleGameRecord[];
  nextCursor: string;
}

export interface ScoreCursor {
  score: number;
  id: string;
}

export interface ScorePage {
  scores: ScoreRecord[];
  nextCursor: string;
}

export interface CreateServerOptions {
  frontendRoot?: string;
  scoreStore?: ScoreStore;
  titleGameStore?: TitleGameStore;
}

export interface SupabaseConfig {
  url: string;
  key: string;
}

export interface SupabaseScoreRow {
  id: string;
  name: string;
  score: number;
  created_at: string;
  title_game_id: string;
}

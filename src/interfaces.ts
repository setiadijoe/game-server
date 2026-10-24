export interface ScoreRecord {
  id: string;
  name: string;
  score: number;
  createdAt: string;
}

export interface ScoreStore {
  list(limit: number, cursor?: ScoreCursor): Promise<ScorePage>;
  create(name: string, score: number): Promise<ScoreRecord>;
  close?(): Promise<void>;
}

export interface TitleGameRecord {
  id: string;
  created_at: string;
  game_name: string;
}

export interface TitleGameStore {
  create(gameName: string): Promise<TitleGameRecord>;
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
}

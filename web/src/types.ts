export type Verdict =
  | "optimal"
  | "good"
  | "missed_progression"
  | "clear_upgrade"
  | "offside"
  | "too_risky"
  | "should_shoot"
  | "should_pass"
  | "suboptimal";

export interface Team {
  idx: number;
  name: string;
  short: string;
  formation: string;
  style: string;
  color: string;
}

export interface Player {
  idx: number;
  team: number;
  number: number;
  name: string;
  position: string;
  role: string;
}

export interface Option {
  kind: "pass" | "shot";
  style: string;
  receiver: number | null;
  target: [number, number];
  p: number;
  xt: number;
  ev: number;
  bypassed: number;
  beaten: number[];
  offside?: boolean;
  lofted?: boolean; // ball played through the air
  threat: number | null;
}

export interface Decision {
  id: number;
  t: number;
  type: "pass" | "shot";
  player: number;
  team: number;
  verdict: Verdict;
  cost: number;
  xt_start: number;
  outcome: string | null;
  set_piece: string | null;
  chosen: Option;
  best: Option;
  alts: Option[];
  start: [number, number];
  offside_line: number | null; // raw pitch x of the offside line when the ball was played
  offside_players: number[]; // team-mates standing offside at that moment
}

export interface MatchEvent {
  id: number;
  type: string;
  t: number;
  player: number | null;
  team: number | null;
  outcome?: string;
  score?: [number, number];
  start?: [number, number];
  end?: [number, number];
  xg?: number;
}

export interface Stat {
  decisions: number;
  optimal: number;
  cost: number;
  decision_score: number;
  pass_completion?: number;
  xg?: number;
  shots?: number;
}

export interface Bundle {
  meta: { seed: number; fps: number; t0: number; duration: number; score: [number, number]; good_threshold: number };
  teams: Team[];
  players: Player[];
  frames: number[][];
  events: MatchEvent[];
  decisions: Record<string, Omit<Decision, "id" | "start">>;
  key_moments: number[];
  team_stats: Record<string, Stat>;
  player_stats: Record<string, Stat>;
}

export interface Match {
  meta: Bundle["meta"];
  teams: Team[];
  players: Player[];
  frames: Int16Array; // per frame: period, ball x, y, z, then 22 * (x, y) — decimetres
  stride: number;
  nFrames: number;
  kickoff2: number; // match time of the second-half kickoff
  events: MatchEvent[];
  decisions: Decision[]; // sorted by time
  byId: Map<number, Decision>;
  keyMoments: Decision[];
  goals: MatchEvent[];
  teamStats: Record<string, Stat>;
  playerStats: Record<string, Stat>;
}

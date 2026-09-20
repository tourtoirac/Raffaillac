export interface AppConfig {
  host: string;
  port: number;
  game_name_list: string[];
}

export interface BoardItem {
  kind: "board";
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TokenItem {
  kind: "token";
  id: string;
  front_src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  move_border?: boolean;
  shadow?: boolean;
}

export interface SessionComponents {
  fixed: BoardItem[];
  movable: TokenItem[];
}

export interface Session {
  key: string;
  components?: SessionComponents;
  session?: { components?: SessionComponents };
  players?: SessionPlayer[];
  [key: string]: unknown;
}

export interface SessionPlayer {
  nickname: string;
  owner?: boolean;
}

export interface GameInfo {
  name: string;
  variant?: Record<string, { name: string }>;
}

export interface ActiveSession {
  code?: string;
  players?: SessionPlayer[];
}

export interface SessionsInfoEvent {
  content: { active?: Record<string, ActiveSession[]> };
}

export interface ListGameEvent {
  game_list?: GameInfo[];
}

export interface SessionCreatedEvent {
  session?: Session;
}
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
  players?: SessionPlayer[];
}

export interface SessionPlayer {
  nickname: string;
  owner?: boolean;
}

export interface GameVariantInfo {
  name: string;
  min_players?: number;
  max_players?: number;
  max_watchers?: number;
}

export interface GameInfo {
  name: string;
  variant?: Record<string, GameVariantInfo>;
}

export interface ActiveSession {
  code?: string;
  players?: SessionPlayer[];
  max_players?: number;
  max_watchers?: number;
}

export interface SessionsInfoEvent {
  content: { active?: Record<string, ActiveSession[]> };
}

export interface ListGameEvent {
  game_list?: GameInfo[];
}

// message de session reçu après create_session ou join_session
export interface SessionCreatedEvent {
  session?: Session;
}

// accusé d'acquisition / de relâchement, diffusé à tous les joueurs de la session
interface HandEventBase {
  component_id: string;
  user: string;
  success: boolean;
}

export interface AcquireEvent extends HandEventBase {
  event: "acquire";
}

export interface ReleaseEvent extends HandEventBase {
  event: "release";
}

// nouvelle position d'un composant, reçue des autres joueurs de la session
export interface MoveEvent {
  event: "move";
  component_id: string;
  x: number;
  y: number;
}

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
  border?: boolean;
}

export interface DiceItem {
  kind: "dice";
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** face actuellement affichée */
  src: string;
  /** toutes les faces, préchargées par le client */
  src_list: string[];
  /** délai avant le prochain lancer, en secondes, propre au jeu */
  roll_delay?: number;
}

export interface SessionComponents {
  fixed: BoardItem[];
  movable: TokenItem[];
  // absent d'un Tourtoirac plus ancien : le dé est donc facultatif
  dice?: DiceItem[];
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
  /** le créateur a-t-il laissé cette partie ouverte aux spectateurs */
  allows_watchers?: boolean;
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
  // rôle de ce client dans la session : seuls les joueurs peuvent agir
  role?: "player" | "watcher";
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
  // position à jour du composant au moment du lâcher
  component_json?: ComponentState;
}

// sous-ensemble de return_json() renvoyé par Tourtoirac pour un composant
export interface ComponentState {
  id: string;
  x: number;
  y: number;
  /** rectangle vert : false une fois le jeton déplacé */
  border?: boolean;
  move_border?: boolean;
}

// le joueur a remis le rectangle vert sur tous les jetons
export interface FixPositionsEvent {
  event: "fix_positions";
  components: ComponentState[];
}

// nouvelle position d'un composant, reçue des autres joueurs de la session
export interface MoveEvent {
  event: "move";
  component_id: string;
  // Tourtoirac imbrique la position sous "coordinates"
  coordinates: ComponentState;
}

// face tirée par un joueur, diffusée à toute la session
export interface RollEvent {
  event: "roll";
  component_id: string;
  /** image de la face tirée */
  src: string;
  /** délai avant le prochain lancer, en secondes */
  cooldown_seconds: number;
}

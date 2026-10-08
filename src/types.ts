export interface AppConfig {
  host: string;
  port: number;
}

export interface BoardItem {
  kind: "board";
  /** id du plateau : le setup du jeu s'en sert pour le deplacer */
  id: string;
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** flippable : le jeu autorise-t-il le retournement local de ce plateau */
  flippable?: boolean;
}

export interface TokenItem {
  kind: "token";
  id: string;
  front_src: string;
  /** face de dos : absente ou nulle sur un pion qui ne se retourne pas */
  back_src?: string | null;
  /** face affichée, telle que le serveur l'a rendue */
  side?: "front" | "back";
  x: number;
  y: number;
  width: number;
  height: number;
  /** le jeu autorise-t-il à repositionner ce pion pendant le tour */
  move_border?: boolean;
  /**
   * border : le jeu demande-t-il une ombre sous le pion ? Rendu figé, le pion
   * garde son ombre même après avoir bougé
   */
  border?: boolean;
  /**
   * in_place : le pion est-il sur sa case de départ ? C'est le rectangle vert,
   * que le serveur retire dès que le pion bouge
   */
  in_place?: boolean;
  /** le jeu autorise-t-il les zones de rotation sur ce pion */
  orientable?: boolean;
  /** angle courant, en degrés vers la droite */
  orientation?: number;
  /**
   * "transparent" affiche le pion en transparence sur sa case d'origine et
   * renvoie le pion dessus quand on l'y dépose ; null sur un pion ordinaire
   */
  origin?: string | null;
  /**
   * case d'origine du pion : là où il revient quand on le dépose. Égale à
   * origin_x/origin_y au lancement du jeu, puis le setup et "Fixe la position"
   * l'en écartent — le rectangle vert la suit, le fantôme non.
   */
  initial_x?: number;
  initial_y?: number;
  /**
   * où est posé le fantôme "transparent", figé à l'installation du jeu. Absent
   * ou null quand le jeu ne demande pas de fantôme.
   */
  origin_x?: number | null;
  origin_y?: number | null;
}

/**
 * Un compteur : un pave fige qui affiche une valeur, qu'on fait monter ou
 * descendre d'un cran avec les deux zones + et -. Il est déclaré parmi les
 * composants "fixed" : il bouge donc avec le plateau, jamais avec les pions.
 */
export interface CounterItem {
  kind: "counter";
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** couleur du fond du composant, telle que le jeu l'a choisie */
  color: string;
  /**
   * couleur du chiffre, choisie separement du fond. Absente d'un jeu qui ne la
   * donne pas, le chiffre prend alors la couleur du fond.
   */
  font_color?: string;
  /** la valeur affichée ; absente d'un jeu qui l'omet, le compteur vaut 0 */
  value?: number;
  /**
   * borne basse de la valeur. Absente ou null : le compteur peut descendre
   * sans fin, jusqu'aux nombres negatifs s'il le faut. Sinon le serveur refuse
   * de descendre plus bas, et le client grise le signe -.
   */
  min?: number | null;
  /**
   * borne haute de la valeur. Absente ou null : le compteur peut monter sans
   * fin. Sinon le serveur refuse de monter plus haut, et le client grise le
   * signe +.
   */
  max?: number | null;
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
  // un plateau, un compteur : tout ce qui ne bouge pas avec les pions
  fixed: (BoardItem | CounterItem)[];
  movable: TokenItem[];
  // absent d'un Tourtoirac plus ancien : le dé est donc facultatif
  dice?: DiceItem[];
}

// position du bouton "Fixe la position", choisie par le jeu dans son game_json
export interface FixPositionButton {
  x: number;
  y: number;
}

export interface SessionOptions {
  /**
   * absent : le client garde son bouton a sa position par defaut ;
   * null : le jeu ne veut pas du bouton ; objet : le bouton va a cet endroit
   */
  fix_positions?: FixPositionButton | null;
}

export interface Session {
  key: string;
  // le code sert a retrouver la session cote serveur quand elle a ete retiree
  // de la memoire apres le depart du dernier participant (passage lobby -> jeu)
  code?: string;
  components?: SessionComponents;
  players?: SessionPlayer[];
  options?: SessionOptions;
  /**
   * modifications que le jeu demande d'apporter apres l'installation de la
   * partie. Le serveur les vide des qu'elles sont faites : un client qui rejoint
   * apres coup ne replace donc rien.
   */
  setup?: SetupEntry[];
  /**
   * la partie a-t-elle commencé ? Avant, personne ne prend de pion ; après,
   * plus aucun nouveau joueur ne peut la rejoindre
   */
  started?: boolean;
  /** joueurs qui ont un siège mais ne sont pas à la table */
  missing_players?: string[];
}

/**
 * une modification de la mise en place d'un jeu. Les positions sont absolues :
 * reappliquer le setup ne bouge rien, deux joueurs peuvent donc le demander sans
 * que la partie bouge deux fois.
 */
export interface SetupEntry {
  component_id: string;
  x?: number;
  y?: number;
  /**
   * face a afficher. Exige que le composant se retourne : un pion sans image de
   * dos, un plateau ou un de gardent la face qu'ils montrent.
   */
  side?: "front" | "back";
}

export interface SessionPlayer {
  nickname: string;
  owner?: boolean;
  /** ce joueur est-il actuellement connecté à la partie ? */
  connected?: boolean;
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
  /** une partie commencée n'accepte plus de nouveau joueur */
  started?: boolean;
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
  // ce client a-t-il créé la partie ? seul l'owner peut la clore. Le serveur
  // en est seul juge : le client ne fait que lire la réponse
  owner?: boolean;
}

// état de la partie, diffusé à chaque changement : démarrage, joueur qui part
// ou revient. Un pion ne se prend que si la partie a commencé et que personne
// ne manque à la table
export interface SessionStatusEvent {
  event: "session_status";
  started: boolean;
  missing_players: string[];
}

// la partie a été archivée : plus rien n'y bouge, tout le monde regarde
export interface SessionClosedEvent {
  event: "session_closed";
}

// refus du serveur, always reported with a stable code the client can test
export interface ServerErrorEvent {
  event?: "error";
  error?: { code?: string; message?: string };
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
  /** in_place : rectangle vert, false une fois le jeton déplacé */
  in_place?: boolean;
  move_border?: boolean;
  /** case de départ mise à jour par "fixe la position" */
  initial_x?: number;
  initial_y?: number;
  /**
   * où le serveur veut le fantôme. Il ne change jamais en cours de partie : il
   * est renvoyé pour qu'un écran qui n'avait pas encore lu la session puisse
   * le poser, jamais pour le deplacer.
   */
  origin_x?: number | null;
  origin_y?: number | null;
  /** face affichée, pour un pion que le setup retourne */
  side?: "front" | "back";
}

// le joueur a remis le rectangle vert sur tous les jetons
export interface FixPositionsEvent {
  event: "fix_positions";
  components: ComponentState[];
}

// le setup du jeu vient d'être appliqué : chaque écran replace ses composants
export interface SetupEvent {
  event: "setup";
  components: ComponentState[];
}

// un compteur a été incrémenté ou décrémenté : le serveur renvoie la valeur
// atteinte, jamais le client ne la choisit
export interface CounterValueEvent {
  event: "counter_value";
  component_id: string;
  value: number;
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

// un joueur a fait pivoter un pion, diffusé à toute la session
export interface RotateEvent {
  event: "rotate";
  component_id: string;
  /** nouvel angle, en degrés vers la droite, ramené dans [0, 360) */
  orientation: number;
}

// un joueur a retourné un pion, diffusé à toute la session
export interface FlipEvent {
  event: "flip";
  component_id: string;
  /** face désormais affichée */
  side: "front" | "back";
  front_src: string;
  back_src: string;
}

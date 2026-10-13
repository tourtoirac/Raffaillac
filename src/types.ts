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
  /**
   * optional hex grid of the map: when the board_group holding the board has
   * magnetism, Tourtoirac snaps a released token's center onto the nearest hex
   * center. Null on a board saved without grid.
   */
  grid?: HexGridItem | null;
}

/**
 * One to n boards making up a single map. A board is never turned over alone:
 * with flippable, one button turns the whole group over, by a half-turn around
 * its center, with everything laid on it. The flip stays local to this player.
 * Each board keeps its own id (setup, grid).
 */
export interface BoardGroupItem {
  kind: "board_group";
  id: string;
  flippable?: boolean;
  /**
   * tokens snap to the grids of the boards only when true; otherwise the grids
   * are only drawn. A board alone never snaps.
   */
  magnetism?: boolean;
  boards: BoardItem[];
}

/** Hex grid of a board, in game_json units, relative to its top-left corner. */
export interface HexGridItem {
  type?: "hex";
  /** "flat" (flat top, the default) or "pointy" (pointed top) */
  orientation?: "flat" | "pointy";
  /** center of one hex */
  origin_x: number;
  origin_y: number;
  /** center-to-corner radius */
  size: number;
  /** vertical radius, for a slightly stretched scan; defaults to size */
  size_y?: number;
  /** no snap beyond this distance from the center; absent means no limit */
  snap_radius?: number;
}

export interface TokenItem {
  /** a card is described like a token: it only differs by what a deck accepts */
  kind: "token" | "card";
  id: string;
  /**
   * null when the server keeps this face back: the hidden face of a token of
   * a nationality is only sent to the players of that nationality
   */
  front_src: string | null;
  /**
   * face de dos : absente ou nulle sur un pion qui ne se retourne pas, or
   * kept back by the server like front_src
   */
  back_src?: string | null;
  /** face affichée, telle que le serveur l'a rendue */
  side?: "front" | "back";
  /** the side the token belongs to, among the nationalities of the game */
  nationality?: string | null;
  /** null as long as the token waits inside a bag */
  x: number | null;
  y: number | null;
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
  initial_x?: number | null;
  initial_y?: number | null;
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

/**
 * One to n dice thrown together. The pool has no picture and no place of its
 * own: it is declared in "fixed" and only says which dice belong together. One
 * "roll" button, drawn above its dice, throws them all at once. Each dice
 * keeps its own id and is still rolled alone by a click.
 */
export interface DicePoolItem {
  kind: "dice_pool";
  id: string;
  dice: DiceItem[];
}

/**
 * A bag: a fixed component holding tokens out of sight. A token released over
 * it joins its content, a click takes one out at random, into the hand of the
 * player. The tokens it holds have no position: x and y are null until picked.
 */
export interface BagItem {
  kind: "bag";
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** picture of the bag; absent or null, the client draws a plain box */
  src?: string | null;
  /** caption written under the bag; absent, null or empty, nothing is written */
  text?: string | null;
  /** true shows the number of tokens left in the bag; absent, it is hidden */
  count?: boolean;
  components: TokenItem[];
}

export type DeckPileName = "draw" | "discard";

/** a pile of a deck, as everybody may know it */
export interface DeckPileItem {
  x: number;
  y: number;
  /** number of cards of the pile */
  count: number;
  /** what the top card shows on this pile; null on an empty pile */
  top: HandBack | null;
}

/**
 * A deck: a fixed component holding cards, and only cards. "single" is one
 * pile, "duo" a draw pile and a discard pile. The cards stay on the server:
 * they come one by one, when they are drawn.
 *
 * A "stack" is a deck of one single pile that deals its cards: its width and
 * height are those of the area the cards are centered in, not of a card.
 */
export interface DeckItem {
  kind: "deck" | "stack";
  id: string;
  type: "single" | "duo";
  x: number;
  y: number;
  /** size of one pile, that is of one card; for a stack, of its area */
  width: number;
  height: number;
  /** caption written above the deck; absent, null or empty, nothing is written */
  text?: string | null;
  /** a single deck only has the draw pile */
  piles: Partial<Record<DeckPileName, DeckPileItem>>;
}

export interface SessionComponents {
  // a board, a counter, a dice pool, a bag, a deck, a stack: whatever does not move with the tokens
  fixed: (BoardItem | BoardGroupItem | CounterItem | DicePoolItem | BagItem | DeckItem)[];
  movable: TokenItem[];
  // absent d'un Tourtoirac plus ancien : le dé est donc facultatif
  dice?: DiceItem[];
}

export interface SessionOptions {
  /**
   * false: the game does not want the "Fixe la position" button in the bar
   * under the header. Absent or true: the button is shown.
   */
  fix_positions?: boolean | null;
  /**
   * null or false: the game does not want the "Copie d'écran" button in that
   * same bar. Absent or anything else: the button is shown.
   */
  screen_capture?: boolean | null;
  /**
   * true: the view scrolls when the pointer comes near an edge of the
   * screen. Absent or anything else: it only moves with the right button.
   */
  border_shift?: boolean | null;
  /**
   * the sides the game declares, as written in its game_json. The session
   * repeats them, cleaned, in Session.nationalities: read that one.
   */
  nationalities?: string[];
  /**
   * true: the server replaced the id of every token by a random one when the
   * session was created, so that an id does not tell what a token is
   */
  anonymous_id?: boolean;
  /** set by the server once the ids have been replaced */
  anonymized?: boolean;
  /**
   * an object, even empty: each player keeps tokens and cards in a private
   * hand. Absent or null, the game has no private hand
   */
  private_hand?: PrivateHandOptions | null;
  /**
   * false: the info bar does not show the name and the position of the
   * tokens. Absent or true, it does.
   */
  component_id_display?: boolean;
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
  /** everybody attached to the game: the seats first, then the watchers */
  participants?: SessionParticipant[];
  /** the sides the game declares; empty or absent when it has none */
  nationalities?: string[];
  /** the nationality of each seat, by nickname */
  player_nationalities?: Record<string, string>;
  /** the PDF files the game lets the players consult; empty or absent when it has none */
  documents?: SessionDocument[];
  /** what everybody sees of the private hands, by nickname */
  hands?: SessionHands;
  /** the private hand of the reader, with its faces; empty for a watcher */
  hand?: TokenItem[];
  /** the cards the players show of their hand, as far as the reader may read them */
  shows?: ShowEvent[];
}

/**
 * a token kept in the private hand of a player, as the others see it: its
 * back and its size. src is null when the token has no back to show.
 */
export interface HandBack {
  src: string | null;
  width: number;
  height: number;
}

export type SessionHands = Record<string, HandBack[]>;

/** what options.private_hand may hold; an empty object is a plain private hand */
export interface PrivateHandOptions {
  /** true: a player may show cards of its hand to one or all the other players */
  show_hands_to_other_players?: boolean;
  [key: string]: unknown;
}

/**
 * The cards a player shows of its private hand, as the reader may read them.
 * Sent to the players only, at each change and with the session.
 */
export interface ShowEvent {
  event: "show";
  /** the nickname of the player showing its cards */
  owner: string;
  /** "all", the nickname of the one player reading them, or null: nothing is shown to the reader */
  to: string | null;
  /** the cards as they are, on the side their owner left them */
  cards: HandBack[];
  /** the ids of those cards, for their owner only; empty for anybody else */
  component_ids: string[];
}

/** a document of the game ("documents" of its game_json): always a PDF */
export interface SessionDocument {
  src: string;
  name: string;
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

/** a line of the list of names shown on the right of the game page */
export interface SessionParticipant {
  nickname: string;
  role: "player" | "watcher";
  /** false: a player who has a seat but is not at the table */
  connected: boolean;
}

export interface SessionPlayer {
  nickname: string;
  owner?: boolean;
  /** ce joueur est-il actuellement connecté à la partie ? */
  connected?: boolean;
  /** the side this player took; null when the game declares none */
  nationality?: string | null;
}

export interface GameVariantInfo {
  name: string;
  min_players?: number;
  max_players?: number;
  max_watchers?: number;
  /** the sides a player chooses from when creating a game of this variant */
  nationalities?: string[];
}

/** the family of a game, set in Chabanas: one tab of the lobby per type */
export type GameType = "Boardgame" | "Wargame";

export interface GameInfo {
  name: string;
  /** absent from an older Chabanas: the game is then filed as a wargame */
  type?: GameType;
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
  /** the sides a new player of this game chooses from */
  nationalities?: string[];
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
  /** the nationality of this client's seat; null for a watcher or a game without any */
  nationality?: string | null;
}

// état de la partie, diffusé à chaque changement : démarrage, joueur qui part
// ou revient. Un pion ne se prend que si la partie a commencé et que personne
// ne manque à la table
export interface SessionStatusEvent {
  event: "session_status";
  started: boolean;
  missing_players: string[];
  /** absent from an older Tourtoirac */
  participants?: SessionParticipant[];
}

// la partie a été archivée : plus rien n'y bouge, tout le monde regarde
export interface SessionClosedEvent {
  event: "session_closed";
}

// refus du serveur, always reported with a stable code the client can test
export interface ServerErrorEvent {
  event?: "error";
  error?: {
    code?: string;
    message?: string;
    // only with "invalid_component": the component of the game_json that the
    // server could not build
    component_id?: string | null;
    kind?: string | null;
    list?: string | null;
    parent_id?: string | null;
    missing_field?: string | null;
  };
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
  /** the bag the token fell into; null or absent when it stays on the table */
  bag_id?: string | null;
  /** the deck whose pile the card went on; null or absent when it stays on the table */
  deck_id?: string | null;
  /** that deck after the release */
  deck_json?: DeckItem | null;
  /** nickname of the player whose private hand took the token; null or absent otherwise */
  hand_of?: string | null;
  /** what everybody sees of the private hands after this release */
  hands?: SessionHands;
}

// a player played a token of its private hand, sent to the whole session: the
// token is back on the table, in the mouse hand of that player
export interface TakeEvent {
  event: "take";
  /** id of the token */
  component_id: string;
  user: string;
  /** nickname of the player the token came from */
  hand_of: string;
  hands?: SessionHands;
  /** the request_id of the take action, so a client recognises its own */
  request_id?: string | null;
  /** the token played, at the place the server put it */
  component_json: TokenItem;
}

// a player took a token out of a bag, sent to the whole session: the token is
// back on the table, in the hand of that player
export interface PickEvent {
  event: "pick";
  /** id of the bag */
  component_id: string;
  user: string;
  /** the request_id of the pick action, so a client recognises its own */
  request_id?: string | null;
  /** the token picked, at the place the server put it */
  component_json: TokenItem;
}

// a player took the top card of a pile of a deck, sent to the whole session:
// the card is back on the table, in the hand of that player
export interface DrawEvent {
  event: "draw";
  /** id of the deck */
  component_id: string;
  pile: DeckPileName;
  user: string;
  /** the request_id of the draw action, so a client recognises its own */
  request_id?: string | null;
  /**
   * a draw of several cards sends one event for each: index counts them from
   * 0, count is how many came out. Absent from an older Tourtoirac.
   */
  index?: number;
  count?: number;
  /** the card drawn, at the place the server put it; its front is kept back while it lies on its back */
  component_json: TokenItem;
  /** the deck once every card of this draw is out */
  deck_json: DeckItem;
}

// a pile of a deck was shuffled, or its discard pile put back into the draw
export interface DeckEvent {
  event: "shuffle" | "refill";
  /** id of the deck */
  component_id: string;
  pile?: DeckPileName;
  user: string;
  /** nickname of the player who did it */
  nickname?: string;
  deck_json: DeckItem;
}

// a stack dealt its top cards, one to the private hand of each player
export interface DealEvent {
  event: "deal";
  /** id of the stack */
  component_id: string;
  user: string;
  /** nickname of the player who dealt */
  nickname?: string;
  /** the stack without the cards dealt */
  deck_json: DeckItem;
  /** what everybody sees of the private hands after the deal */
  hands?: SessionHands;
  /** the cards dealt to the reader, with their front; empty for a watcher */
  cards?: TokenItem[];
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
  /** the faces the server lets this client know; null for one kept back */
  front_src?: string | null;
  back_src?: string | null;
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

// a player threw a whole dice pool, sent to the whole session in one message
export interface RollPoolEvent {
  event: "roll_pool";
  /** id of the dice_pool */
  component_id: string;
  /** one entry per dice of the pool: the face drawn and its own delay */
  dice: { component_id: string; src: string; cooldown_seconds: number }[];
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
  /** the face now shown is always given; the other is null when kept back */
  front_src: string | null;
  back_src: string | null;
}

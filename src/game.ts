import { bagUnder, createBag, drawBag, hitBag } from "./engine/bag";
import type { Bag } from "./engine/bag";
import {
  createDeck,
  deckButtonAt,
  deckButtons,
  drawButtonAt,
  drawButtons,
  pileFootprint,
  drawDeckButton,
  drawDrawButton,
  drawDeckText,
  drawPile,
  pileAt,
  pileUnder,
  updateDeck,
} from "./engine/deck";
import type { Deck, DeckButton, DeckPile, DrawButton } from "./engine/deck";
import { Button } from "./engine/button";
import { allBoardsLoaded, boardDims, createBoard, createBoardGroup, flipArea, flippedGroup } from "./engine/board";
import type { Board, BoardGroup } from "./engine/board";
import { Counter } from "./engine/counter";
import { snapToHex, traceHex, traceHexesIn } from "./engine/hex_grid";
import type { RotationDirection } from "./engine/counter";
import {
  counterActionZoneAt,
  createCounterBox,
  drawCounterActionZones,
  drawCounterBox,
  hitCounterBox,
  isActionEnabled,
} from "./engine/counter_box";
import type { CounterAction, CounterBox } from "./engine/counter_box";
import { Dice } from "./engine/dice";
import {
  boxAt,
  createMwCharacter,
  drawMwCharacter,
  hitMwCharacter,
  isFlippable,
  readCharacterCards,
} from "./engine/mw_character";
import type { MwCharacter } from "./engine/mw_character";
import type { DicePool } from "./engine/dice";
// shared with the other OBG front ends: OBG/Common/resources
import flipHandIcon from "../../Common/resources/flip_hand.svg";
import { VoiceChat } from "./voice";
// inlined as markup: drawn in currentColor, it takes the color of the name
import handCardsIcon from "../../Common/resources/hand_cards.svg?raw";
import eyeIcon from "../../Common/resources/eye.svg?raw";
import { lobbyReturnUrl, originGameName } from "./navigation";
import { acquireGameLock, GAME_OPEN_ELSEWHERE_MESSAGE } from "./gameLock";
import { invalidComponentMessage } from "./serverErrors";
import { clearSession, loadPlayerIdentity, loadSession, storeSession } from "./session";
import type {
  AcquireEvent,
  BagItem,
  BoardGroupItem,
  BoardItem,
  ComponentState,
  CounterItem,
  CounterValueEvent,
  MarkEvent,
  MwCharacterItem,
  DealEvent,
  ShowEvent,
  GiveEvent,
  VoiceJoinedEvent,
  VoiceMembersEvent,
  ChatEvent,
  VoiceSignalEvent,
  DeckEvent,
  DeckItem,
  DiceItem,
  DicePoolItem,
  DrawEvent,
  FixPositionsEvent,
  FlipEvent,
  MoveEvent,
  ViewEvent,
  FollowedEvent,
  PickEvent,
  ReleaseEvent,
  RollEvent,
  RollPoolEvent,
  RotateEvent,
  ServerErrorEvent,
  Session,
  SessionComponents,
  SessionCreatedEvent,
  SessionDocument,
  SessionHands,
  SessionParticipant,
  SessionStatusEvent,
  SetupEntry,
  SetupEvent,
  TakeEvent,
  TokenItem,
} from "./types";
import { getSocket } from "./ws/wsClient";
import { ChatPanel } from "./chat";
import { showDisconnectedPopup, startIdleWatch } from "./idle";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3.0;
const ZOOM_FACTOR = 1.1;
const RESPONSE_TIMEOUT = 2000;
// repli si le jeu ne dit rien dans son game_json, ou si un Tourtoirac plus
// ancien n'annonçait pas le délai dans l'événement de lancer
const ROLL_COOLDOWN_SECONDS = 5;
// "flip" button of a board_group the game marks flippable: the group turns
// over on this player's screen, without changing anything for the others. It
// is anchored to the group but sized in screen pixels, pour rester cliquable à
// tous les zooms : Vietnam a un plateau de 7600 px de large, où 80 px posés
// dans le monde feraient 5 px à l'écran.
const FLIP_BUTTON_WIDTH = 70;
const FLIP_BUTTON_HEIGHT = 26;
// "roll" button of a dice_pool: it throws every dice of the pool at once. Like
// the "flip" button it is sized in screen pixels; it sits just above the dice,
// so that it never hides one of them.
const ROLL_BUTTON_WIDTH = 70;
const ROLL_BUTTON_HEIGHT = 26;
const ROLL_BUTTON_GAP = 4;
// Stack preview: popup listing every counter under the pointer when there is
// more than one. Distances are in screen pixels; counters inside it are drawn
// at the main view's zoom.
const STACK_PREVIEW_OFFSET = 50;
const STACK_PREVIEW_PADDING = 10;
const STACK_PREVIEW_GAP = 10;
// Badge holding the number of counters of the stack, drawn across the top
// right corner of the popup. Same look as `.hand-count` in game.html.
const STACK_COUNT_FONT = "12px sans-serif";
const STACK_COUNT_HEIGHT = 18;
const STACK_COUNT_PADDING = 6;
const STACK_COUNT_INSET = 12;
// Character preview: the fronts of the cards under an mw_character, at this
// height on screen whatever the zoom, so that they can be read
const CHARACTER_PREVIEW_CARD_HEIGHT = 220;

// ---------------------------------------------
// Défilement de la caméra au bord de l'écran
// ---------------------------------------------

// Vietnam a un plateau de 7600 px de large : impossible à tenir dans une fenêtre.
// Le glissement à la souris Suffit pour un joueur qui ne tient rien, mais un
// pion en main occupe déjà la souris : sans ce défilement, on ne peut pas
// conduire le plateau à l'autre bout de l'écran tout en déplaçant le pion.

// À l'intérieur de cette bande, près du bord, la caméra défile. En pixels
// d'écran, donc independent du zoom : c'est la distance au bord de la fenêtre
// que le joueur garde, pas une distance dans le monde.
const EDGE_BAND = 90;

// La vitesse est nulle au bord exact de la bande et maximale à celui de
// l'écran : un dégradé, pour que le franchissement soit doux plutôt que
// saccadé. On élève la fraction au carré plutôt que de la premiere puissance.
const EDGE_EASE = 2;

// Vitesse maximale du défilement, en pixels d'écran par seconde. Assez pour
// traverser le plateau de Vietnam en quelques secondes, assez lent pour viser
// une case sans la dépasser.
const EDGE_SCROLL_SPEED = 900;

// Léger retard avant le premier déplacement, pour qu'un pointeur pressé contre
// le bord — la plupart du temps un simple geste vers le bord — ne fasse pas
// défiler la carte.
const EDGE_SCROLL_DELAY_MS = 250;

// Un onglet en arrière-plan ne rafraîchit plus : le pas de temps qu'il retrouve
// en revenant au premier plan est énorme. On le borne pour que la carte ne
// saute pas d'un coup.
const EDGE_SCROLL_MAX_FRAME_MS = 50;

type HandEvent = AcquireEvent | ReleaseEvent;

interface GameServerMessage {
  event?: string;
  session?: Session;
  [key: string]: unknown;
}

// -------------------------------------------------
// Canvas : taille du viewport
// -------------------------------------------------

const canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

function fitCanvasSize(): void {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}

fitCanvasSize();

// -------------------------------------------------
// Lecture de la session
// -------------------------------------------------

let currentSession: Session | null = loadSession();

// seul le créateur de la partie peut l'archiver. Le serveur l'annonce dans
// l'événement de session, l'interface ne fait que le refléter.
let isOwner = false;

// la partie a été close par son owner : elle est archivée, plus rien n'y bouge
let isClosed = false;

// la partie a-t-elle commencé, et qui manque à la table ? Le serveur le diffuse
// à chaque changement ; un pion ne se prend que si elle a commencé et que tous
// ses joueurs sont là. Le serveur refuse de toute façon un acquire hors de ces
// conditions : la page ne fait que s'épargner une requête vouée à l'échec.
let isStarted = false;
let missingPlayers: string[] = [];

// The names of the game, in a panel on the right of the table. The reader
// always comes first; a player at the table, a player away from it and a
// watcher each have their own colour (game.html).
const participantsPanel = document.getElementById("participants");
const participantsList = document.getElementById("participants-list");

let participants: SessionParticipant[] = [];

function updateParticipants(received: SessionParticipant[] | undefined): void {
  // an older Tourtoirac does not send the list: what is shown stays as it is
  if (!Array.isArray(received)) return;
  participants = received;
  // a followed player who left the game or the table is no longer followed,
  // even once back
  if (
    followedPlayer !== null &&
    !received.some(
      (entry) => entry.role === "player" && entry.nickname === followedPlayer && entry.connected,
    )
  ) {
    stopFollowing();
  }
  renderParticipants();
  updateChatPartners();
  // the players the hand can be shown to are those of that list
  renderShowSelect();
}

// The player line the owner is dragging to another place of the list.
let draggedParticipant: string | null = null;

function clearParticipantDropMarks(): void {
  participantsList
    ?.querySelectorAll(".drop-before, .drop-after")
    .forEach((line) => line.classList.remove("drop-before", "drop-after"));
}

// The owner dropped the name of a player on another one: the whole new order
// is asked for, and every screen gets it back with a session_status.
function requestPlayerOrder(moved: string, target: string, after: boolean): void {
  const names = participants
    .filter((entry) => entry.role === "player" && entry.nickname !== moved)
    .map((entry) => entry.nickname);
  const at = names.indexOf(target);
  if (at < 0) return;
  names.splice(after ? at + 1 : at, 0, moved);
  const message = { action: "order_players", nicknames: names };
  getSocket()?.send(message);
  console.log("[WS] Envoyé :", JSON.stringify(message));
}

// Only the owner of a game still open moves the names of the players.
function makeParticipantSortable(line: HTMLLIElement, nickname: string): void {
  line.draggable = true;
  line.classList.add("sortable");
  line.addEventListener("dragstart", (event) => {
    draggedParticipant = nickname;
    hideHandPreview();
    event.dataTransfer?.setData("text/plain", nickname);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  });
  line.addEventListener("dragover", (event) => {
    if (draggedParticipant === null || draggedParticipant === nickname) return;
    // accepting the drop is what lets the drop event fire
    event.preventDefault();
    const box = line.getBoundingClientRect();
    const after = event.clientY > box.top + box.height / 2;
    clearParticipantDropMarks();
    line.classList.add(after ? "drop-after" : "drop-before");
  });
  line.addEventListener("dragleave", () => line.classList.remove("drop-before", "drop-after"));
  line.addEventListener("drop", (event) => {
    event.preventDefault();
    const moved = draggedParticipant;
    const after = line.classList.contains("drop-after");
    draggedParticipant = null;
    clearParticipantDropMarks();
    if (moved !== null && moved !== nickname) requestPlayerOrder(moved, nickname, after);
  });
  line.addEventListener("dragend", () => {
    draggedParticipant = null;
    clearParticipantDropMarks();
  });
}

function renderParticipants(): void {
  if (!participantsPanel || !participantsList) return;
  const me = loadPlayerIdentity()?.name;
  // the order is the one of the server: the players as they joined the game,
  // or as its owner arranged them, then the watchers
  const ordered = participants;
  participantsList.replaceChildren(
    ...ordered.map((entry) => {
      const line = document.createElement("li");
      // the game gives each player its own image (player_icons): it takes the
      // place of the hand icon
      if (entry.role === "player" && entry.icon) {
        const icon = document.createElement("img");
        icon.className = "player-icon";
        icon.src = entry.icon;
        icon.alt = "";
        line.append(icon);
      } else if (privateHandEnabled && entry.role === "player") {
        // with private hands, each player has a hand: an icon before its name
        const icon = document.createElement("span");
        icon.className = "hand-icon";
        icon.innerHTML = handCardsIcon;
        line.append(icon);
      }
      // in the voice channel: a dot, lit while that player speaks
      if (voice.members.includes(entry.nickname)) {
        const dot = document.createElement("span");
        dot.className = "voice-dot";
        if (voice.speaking.has(entry.nickname)) dot.classList.add("speaking");
        dot.title = "Dans le salon audio";
        line.append(dot);
      }
      // cut by the stylesheet when it is too long for the column
      const name = document.createElement("span");
      name.className = "participant-name";
      name.textContent = entry.nickname;
      line.append(name);
      // the eye next to another player follows its view
      if (entry.nickname !== me && entry.role === "player") {
        line.append(followEyeButton(entry.nickname));
      }
      line.title = entry.nickname;
      line.dataset.nickname = entry.nickname;
      line.classList.add(entry.role === "watcher" ? "watcher" : "player");
      if (!entry.connected) line.classList.add("absent");
      if (entry.nickname === me) line.classList.add("self");
      if (entry.role === "player" && isOwner && !isClosed) {
        makeParticipantSortable(line, entry.nickname);
      }
      // how many tokens this player keeps in its private hand
      const held = entry.role === "player" ? (handsByNickname[entry.nickname]?.length ?? 0) : 0;
      if (held > 0) {
        const count = document.createElement("span");
        count.className = "hand-count";
        count.textContent = String(held);
        line.append(count);
        line.title = `${entry.nickname} : ${held} en main`;
      }
      // the pointer on the name of another player shows the backs of its hand
      if (entry.nickname !== me && entry.role === "player") {
        // a card carried by the reader is given to that player when released here
        if (privateHandEnabled && !isWatcher) line.classList.add("hand-receiver");
        line.addEventListener("mouseenter", () => showHandPreview(entry.nickname, line));
        line.addEventListener("mouseleave", hideHandPreview);
      }
      return line;
    }),
  );
  // the panel takes its width from the table: the ResizeObserver of the
  // canvas follows
  participantsPanel.hidden = ordered.length === 0;
  // the list was rebuilt under the pointer: the window follows the new hand
  if (previewedNickname !== null) fillHandPreview(previewedNickname);
}

if (participantsPanel) participantsPanel.addEventListener("mouseleave", hideHandPreview);

// -------------------------------------------------
// Text chat
// -------------------------------------------------
// A window at the bottom of the table, on the left of the participants: the
// general channel, and for a player a private channel with each other player.
const chatPanelElement = document.getElementById("chat-panel");
const chat = chatPanelElement
  ? new ChatPanel(chatPanelElement, {
      send: (message) => {
        getSocket()?.send(message);
        console.log("[WS] Envoyé :", JSON.stringify(message));
      },
      myName: () => loadPlayerIdentity()?.name,
    })
  : null;

// the private tabs follow the players of the game; a watcher has none
function updateChatPartners(): void {
  const players = participants.filter((entry) => entry.role === "player").map((entry) => entry.nickname);
  chat?.setPartners(players, !isWatcher);
}

// -------------------------------------------------
// Voice channel
// -------------------------------------------------
// The players of the game talk to each other (src/voice.ts): the buttons are
// at the top of the participants panel, a watcher has none.

const voiceControls = document.getElementById("voice-controls");
const voiceJoinButton = document.getElementById("voice-join-button") as HTMLButtonElement | null;
const voiceMuteButton = document.getElementById("voice-mute-button") as HTMLButtonElement | null;

const voice = new VoiceChat(
  {
    send: (message) => {
      const socket = getSocket();
      if (!socket) return;
      socket.send(message);
      // offers and candidates are many and long: not logged
      if (message.action !== "voice_signal") console.log("[WS] Envoyé :", JSON.stringify(message));
    },
    onChange: () => {
      refreshVoiceDots();
      updateVoiceControls();
    },
  },
  () => loadPlayerIdentity()?.name,
);

// Who speaks changes several times a second: the dots are lit in place, and
// the list is only rebuilt when somebody enters or leaves the channel (a
// rebuild would break the drag of a name by the owner).
function refreshVoiceDots(): void {
  if (!participantsList) return;
  const dots = [...participantsList.querySelectorAll<HTMLElement>("li[data-nickname] .voice-dot")];
  const shown = dots.map((dot) => dot.closest<HTMLElement>("li")?.dataset.nickname ?? "");
  const sameMembers =
    shown.length === voice.members.length && shown.every((name) => voice.members.includes(name));
  if (!sameMembers) {
    renderParticipants();
    return;
  }
  dots.forEach((dot, index) => dot.classList.toggle("speaking", voice.speaking.has(shown[index])));
}

function updateVoiceControls(): void {
  if (!voiceControls || !voiceJoinButton || !voiceMuteButton) return;
  voiceControls.hidden = isWatcher || isClosed;
  voiceJoinButton.textContent = voice.joined ? "Quitter l'audio" : "Rejoindre l'audio";
  voiceJoinButton.classList.toggle("active", voice.joined);
  voiceMuteButton.hidden = !voice.joined;
  voiceMuteButton.textContent = voice.muted ? "Micro coupé" : "Micro ouvert";
  voiceMuteButton.classList.toggle("muted", voice.muted);
  if (!VoiceChat.available()) {
    voiceJoinButton.disabled = true;
    voiceJoinButton.title = "Le micro n'est accessible qu'en https (ou sur localhost)";
  }
}

voiceJoinButton?.addEventListener("click", () => {
  if (voice.joined) {
    voice.leave();
    return;
  }
  voiceJoinButton.disabled = true;
  voice
    .join()
    .catch((error: unknown) => {
      console.warn("[voice] Micro indisponible :", error);
      window.alert(
        "Impossible d'accéder au micro. Vérifiez qu'un micro est branché et que " +
          "le navigateur a le droit de l'utiliser pour ce site.",
      );
    })
    .finally(() => {
      voiceJoinButton.disabled = false;
      updateVoiceControls();
    });
});
voiceMuteButton?.addEventListener("click", () => voice.toggleMute());
// the other players hang up at once, without waiting for the connection to drop
window.addEventListener("pagehide", () => voice.leave());

// The other player whose name is under the pointer, when a token released
// there would join its private hand; null anywhere else.
function receiverAt(clientX: number, clientY: number): string | null {
  const target = document.elementFromPoint(clientX, clientY);
  const line = target?.closest<HTMLElement>("#participants li.hand-receiver");
  return line?.dataset.nickname ?? null;
}

// Lights the name a release would give the carried token to.
function highlightReceiver(nickname: string | null): void {
  participantsList?.querySelectorAll<HTMLElement>("li.hand-receiver").forEach((line) => {
    line.classList.toggle("drop-target", line.dataset.nickname === nickname);
  });
}

// -------------------------------------------------
// Private hands
// -------------------------------------------------

// What a player keeps off the table. The reader sees its own hand in a strip
// across the bottom of the page, with the faces; of the others it only knows
// how many tokens they hold, and their backs (handsByNickname).
// options.private_hand of the game: an object, even empty, turns the private
// hands on; null or absent turns them off.
// Without it the strip is hidden, nothing is released to a hand and the
// names of the other players show no preview.
let privateHandEnabled = false;

/** Whether a value of options.private_hand turns the private hands on. */
function isPrivateHand(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const privateHand = document.getElementById("private-hand");
const privateHandItems = document.getElementById("private-hand-items");
const flipHandButton = document.getElementById("flip-hand-button") as HTMLButtonElement | null;
const handPreview = document.getElementById("hand-preview");

let myHand: Counter[] = [];
let handsByNickname: SessionHands = {};
// whose hand the preview window shows, null when it is closed
let previewedNickname: string | null = null;
// The token of the strip the left button went down on. It is only asked for
// once the pointer reaches the table: a simple click plays nothing.
let armedHandItem: Counter | null = null;

function setHands(hands: SessionHands | undefined): void {
  // an older Tourtoirac knows no private hand
  if (!hands || typeof hands !== "object") return;
  handsByNickname = hands;
  renderParticipants();
}

function fillHandPreview(nickname: string): void {
  if (!handPreview) return;
  const backs = handsByNickname[nickname] ?? [];
  if (backs.length === 0) {
    hideHandPreview();
    return;
  }
  const title = document.createElement("div");
  title.textContent = `Main de ${nickname} : ${backs.length}`;
  const items = document.createElement("div");
  items.className = "hand-items";
  for (const back of backs) {
    // the strip and the window show every token at the same height
    const ratio = back.height > 0 ? back.width / back.height : 1;
    let item: HTMLElement;
    if (back.src) {
      const image = document.createElement("img");
      image.src = back.src;
      image.alt = "";
      item = image;
    } else {
      // no back to show: a plain card of the shape of the token
      item = document.createElement("div");
      item.textContent = "?";
    }
    item.className = "hand-item";
    item.style.width = `${Math.round(80 * ratio)}px`;
    items.append(item);
  }
  handPreview.replaceChildren(title, items);
  handPreview.hidden = false;
}

function showHandPreview(nickname: string, line: HTMLElement): void {
  // a game without private hands has nothing to show
  if (!handPreview || !privateHandEnabled) return;
  previewedNickname = nickname;
  fillHandPreview(nickname);
  if (handPreview.hidden) return;
  // on the left of the list, at the height of the name, kept inside the page
  const anchor = line.getBoundingClientRect();
  const panel = participantsPanel?.getBoundingClientRect() ?? anchor;
  const box = handPreview.getBoundingClientRect();
  const top = Math.max(8, Math.min(anchor.top, window.innerHeight - box.height - 8));
  handPreview.style.top = `${top}px`;
  handPreview.style.left = `${Math.max(8, panel.left - box.width - 8)}px`;
}

function hideHandPreview(): void {
  previewedNickname = null;
  if (handPreview) handPreview.hidden = true;
}

// Gap, in pixels, between the pointer and the enlarged picture of an item of
// the private hand, and between that picture and the edges of the page.
const HAND_ZOOM_GAP = 12;
const handZoom = document.getElementById("hand-zoom") as HTMLImageElement | null;

// The picture is shown 1:1, one pixel of the file for one pixel of the page,
// and only shrunk when the page is too small to hold it above the pointer.
function showHandZoom(source: HTMLImageElement, event: MouseEvent): void {
  if (!handZoom || source.naturalWidth === 0) return;
  handZoom.src = source.src;
  handZoom.dataset.naturalWidth = String(source.naturalWidth);
  handZoom.dataset.naturalHeight = String(source.naturalHeight);
  handZoom.hidden = false;
  placeHandZoom(event);
}

function placeHandZoom(event: MouseEvent): void {
  if (!handZoom || handZoom.hidden) return;
  const naturalWidth = Number(handZoom.dataset.naturalWidth);
  const naturalHeight = Number(handZoom.dataset.naturalHeight);
  if (!(naturalWidth > 0) || !(naturalHeight > 0)) return;
  // the room above the pointer and across the page
  const roomHeight = Math.max(1, event.clientY - 2 * HAND_ZOOM_GAP);
  const roomWidth = Math.max(1, window.innerWidth - 2 * HAND_ZOOM_GAP);
  const scale = Math.min(1, roomHeight / naturalHeight, roomWidth / naturalWidth);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  const left = Math.min(
    Math.max(HAND_ZOOM_GAP, event.clientX - width / 2),
    window.innerWidth - width - HAND_ZOOM_GAP,
  );
  handZoom.style.width = `${width}px`;
  handZoom.style.height = `${height}px`;
  handZoom.style.left = `${left}px`;
  handZoom.style.top = `${event.clientY - HAND_ZOOM_GAP - height}px`;
}

function hideHandZoom(): void {
  if (handZoom) handZoom.hidden = true;
}

// The strip only exists for a player: a watcher keeps nothing.
function renderPrivateHand(): void {
  if (!privateHand || !privateHandItems) return;
  // nor does a game that does not turn the private hands on
  privateHand.hidden = isWatcher || !privateHandEnabled;
  // the item under the pointer may be leaving the strip
  hideHandZoom();
  renderShowSelect();
  // a card shown to other players waits in its area, not in the strip
  const shownIds = myShownIds();
  // the icon turns over every card of the strip: nothing to do without one
  if (flipHandButton) {
    flipHandButton.disabled = !myHand.some(
      (counter) => !shownIds.has(counter.name) && counter.flippable,
    );
  }
  privateHandItems.replaceChildren(
    ...myHand.filter((counter) => !shownIds.has(counter.name)).map((counter) => {
      const image = document.createElement("img");
      // the holder reads the side its token shows: a card joins the hand
      // face up, and a double click turns over what the hand keeps
      image.src = counter.image.src;
      image.alt = "";
      image.className = "hand-item";
      image.draggable = false;
      if (showComponentId) image.title = counter.name;
      // the pointer on an item shows its picture at its real size
      image.addEventListener("mouseenter", (event) => showHandZoom(image, event));
      image.addEventListener("mousemove", (event) => placeHandZoom(event));
      image.addEventListener("mouseleave", hideHandZoom);
      image.addEventListener("mousedown", (event) => {
        if (event.button !== MOUSE_LEFT) return;
        // the item is about to be played: the enlarged picture would hide the table
        hideHandZoom();
        // no text selection nor native image drag while the token is carried
        event.preventDefault();
        armedHandItem = counter;
      });
      image.addEventListener("dblclick", () => requestHandFlip(counter));
      return image;
    }),
  );
}

// -------------------------------------------------
// Cards of the hand shown to other players
// -------------------------------------------------
// options.private_hand.show_hands_to_other_players: a player opens an area
// over the table for one other player or for all of them, drags cards of its
// hand into it, and closes it to get them back. The cards never leave the
// hand on the server: they are only read by more players (showsByOwner).
let showHandsEnabled = false;
const showsByOwner = new Map<string, ShowEvent>();
const showHandsSelect = document.getElementById("show-hands-select") as HTMLSelectElement | null;
const showZones = document.getElementById("show-zones");
const SHOW_TO_ALL = "all";
// the names the select was last filled with, so that it is only rebuilt when they change
let showSelectNames = "";

function myShownIds(): Set<string> {
  const me = loadPlayerIdentity()?.name;
  return new Set(me ? (showsByOwner.get(me)?.component_ids ?? []) : []);
}

function sendShow(message: Record<string, unknown>): void {
  const socket = getSocket();
  if (!socket) return;
  socket.send(message);
  console.log("[WS] Envoyé :", JSON.stringify(message));
}

// The choices are every other player of the game, and all of them at once.
function renderShowSelect(): void {
  if (!showHandsSelect) return;
  const me = loadPlayerIdentity()?.name;
  const others = participants
    .filter((entry) => entry.role === "player" && entry.nickname !== me)
    .map((entry) => entry.nickname);
  showHandsSelect.hidden = !showHandsEnabled || isWatcher || others.length === 0;
  const names = others.join("\n");
  if (names === showSelectNames && showHandsSelect.options.length > 0) return;
  showSelectNames = names;
  const choices: [string, string][] = [
    ["", "Show hands to ..."],
    [SHOW_TO_ALL, "All players"],
    ...others.map((name): [string, string] => [`player:${name}`, name]),
  ];
  showHandsSelect.replaceChildren(
    ...choices.map(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    }),
  );
}

if (showHandsSelect) {
  showHandsSelect.addEventListener("change", () => {
    const choice = showHandsSelect.value;
    // the select works as a button: it goes back to its label
    showHandsSelect.value = "";
    if (choice === "") return;
    sendShow({
      action: "show_open",
      to: choice === SHOW_TO_ALL ? SHOW_TO_ALL : choice.slice("player:".length),
    });
  });
}

function showItem(src: string | null, width: number, height: number): HTMLElement {
  const ratio = height > 0 ? width / height : 1;
  let item: HTMLElement;
  if (src) {
    const image = document.createElement("img");
    image.src = src;
    image.alt = "";
    image.draggable = false;
    // the pointer on a card shows its picture at its real size
    image.addEventListener("mouseenter", (event) => showHandZoom(image, event));
    image.addEventListener("mousemove", (event) => placeHandZoom(event));
    image.addEventListener("mouseleave", hideHandZoom);
    item = image;
  } else {
    // no picture on that side: a plain card of the shape of the token
    item = document.createElement("div");
    item.textContent = "?";
  }
  item.className = "hand-item";
  item.style.width = `${Math.round(80 * ratio)}px`;
  return item;
}

// A shown card with its rank in the area, the same on the screen of the
// owner and on those of its readers. The server gives each card its rank when
// it is shown: a card leaving the area does not change the others.
function showRank(show: ShowEvent, index: number): number {
  // an older Tourtoirac sends no rank: the position stands for it
  return show.ranks?.[index] ?? index + 1;
}

function numberedShowItem(item: HTMLElement, rank: number): HTMLElement {
  const card = document.createElement("div");
  card.className = "show-card";
  const badge = document.createElement("span");
  badge.className = "show-rank";
  badge.textContent = String(rank);
  card.append(item, badge);
  return card;
}

// One area for each player showing cards to the reader, its own first.
function renderShowZones(): void {
  if (!showZones) return;
  hideHandZoom();
  const me = loadPlayerIdentity()?.name;
  const shows = [...showsByOwner.values()].sort(
    (a, b) => Number(b.owner === me) - Number(a.owner === me),
  );
  showZones.replaceChildren(
    ...shows.map((show) => {
      const mine = show.owner === me;
      const zone = document.createElement("div");
      zone.className = "show-zone";
      if (mine) zone.id = "my-show-zone";
      const label = document.createElement("span");
      label.className = "show-label";
      const readers = show.to === SHOW_TO_ALL ? "all players" : show.to;
      label.textContent = mine ? `Shown to ${readers}` : `Shown by ${show.owner}`;
      const items = document.createElement("div");
      items.className = "hand-items";
      if (mine) {
        // the owner knows its cards: a double click turns one over, as in the strip
        show.component_ids.forEach((id, index) => {
          const counter = countersById.get(id);
          if (!counter) return;
          const item = showItem(counter.image.src, counter.width, counter.height);
          item.addEventListener("dblclick", () => requestHandFlip(counter));
          // grabbed like a card of the strip: dropped on the table it is
          // played, dropped on the strip it is hidden again
          item.classList.add("grabbable");
          item.addEventListener("mousedown", (event) => {
            if (event.button !== MOUSE_LEFT) return;
            hideHandZoom();
            event.preventDefault();
            armedHandItem = counter;
          });
          items.append(numberedShowItem(item, showRank(show, index)));
        });
        if (items.childElementCount === 0) {
          const hint = document.createElement("span");
          hint.className = "show-hint";
          hint.textContent = "Drag cards from your hand here";
          items.append(hint);
        }
      } else {
        items.append(...show.cards.map((card, index) =>
          numberedShowItem(showItem(card.src, card.width, card.height), showRank(show, index)),
        ));
      }
      zone.append(label, items);
      if (mine) {
        const close = document.createElement("button");
        close.type = "button";
        close.textContent = "Close";
        close.addEventListener("click", () => sendShow({ action: "show_close" }));
        zone.append(close);
      }
      return zone;
    }),
  );
}

// The server says what the reader now reads of the area of a player; to is
// null once it is closed, or not meant for the reader.
function applyShow(message: ShowEvent): void {
  if (message.to === null) showsByOwner.delete(message.owner);
  else showsByOwner.set(message.owner, message);
  renderShowZones();
  // the cards of the reader come and go between its area and the strip
  renderPrivateHand();
}

function overMyShowZone(clientX: number, clientY: number): boolean {
  const zone = document.getElementById("my-show-zone");
  if (!zone) return false;
  const box = zone.getBoundingClientRect();
  return clientX >= box.left && clientX <= box.right && clientY >= box.top && clientY <= box.bottom;
}

function overPrivateHand(clientX: number, clientY: number): boolean {
  if (!privateHand || privateHand.hidden) return false;
  const box = privateHand.getBoundingClientRect();
  return clientX >= box.left && clientX <= box.right && clientY >= box.top && clientY <= box.bottom;
}

// A token left the table for a private hand: it is no longer drawn nor
// clickable. When the hand is the reader's, it joins the strip.
function putInPrivateHand(counter: Counter, nickname: string): void {
  putInBag(counter, undefined);
  if (nickname === loadPlayerIdentity()?.name && !myHand.includes(counter)) {
    myHand.push(counter);
    renderPrivateHand();
  }
}

// The pointer came from the strip onto the table with the button down: the
// token is asked for, and arrives under the pointer like one picked from a bag.
function requestTake(counter: Counter, x: number, y: number): void {
  if (!isStarted) {
    warnGameNotStarted();
    return;
  }
  if (missingPlayers.length > 0) {
    warnPlayersMissing();
    return;
  }
  const socket = getSocket();
  if (!socket) return;

  dragging = true;
  releaseOnArrival = false;
  grabbedName = null;
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const message = { action: "take", component_id: counter.name, x, y, request_id: requestId };
  setPending("take", counter.name, requestId);
  socket.send(message);
  console.log("[WS] Envoyé :", JSON.stringify(message));
}

// Tells the player why clicking a component does nothing before the game has
// started, instead of silently ignoring the click.
function warnGameNotStarted(): void {
  window.alert(
    "Vous ne pouvez pas sélectionner de composants dans le jeu tant qu'il n'est " +
      "pas démarré. Cliquez sur le bouton Démarrer la session pour commencer à jouer",
  );
}

// Same for a started game waiting for a seated player to come back.
function warnPlayersMissing(): void {
  window.alert("Tous les joueurs doivent être présents pour pouvoir modifier la table de jeu");
}

const sessionInfo = document.getElementById("session-info");

// Le bandeau affiche le jeu et le joueur plutôt que le nom du site : on sait
// d'un coup d'œil où l'on est et sous quelle identité.
const gameTitle = document.getElementById("game-title");

// the nationality of this player's seat, as the server announces it; null for
// a watcher or a game that declares none
let myNationality: string | null = null;

function updateGameTitle(): void {
  if (!gameTitle) return;
  const gameName = originGameName() ?? "Online Boardgames";
  const nickname = loadPlayerIdentity()?.name;
  const player = nickname && myNationality ? `${nickname} (${myNationality})` : nickname;
  gameTitle.textContent = player ? `${gameName} — ${player}` : gameName;
}

updateGameTitle();

function updateSessionInfo(): void {
  if (!sessionInfo) return;
  if (!currentSession?.key) {
    sessionInfo.textContent = "Aucune session active";
  } else if (isClosed) {
    sessionInfo.textContent = `Session ${currentSession.key} (partie close)`;
  } else if (!isStarted) {
    sessionInfo.textContent = `Session ${currentSession.key} (partie non démarrée)`;
  } else if (missingPlayers.length > 0) {
    sessionInfo.textContent =
      `Session ${currentSession.key} (en attente de : ${missingPlayers.join(", ")})`;
  } else {
    sessionInfo.textContent = `Session ${currentSession.key}`;
  }
}

updateSessionInfo();

// -------------------------------------------------
// Situation initiale
// -------------------------------------------------

let boards: Board[] = [];
// board_group components: their boards are also in "boards", in drawing order
let boardGroups: BoardGroup[] = [];
let counters: Counter[] = [];
const countersById = new Map<string, Counter>();

// les compteurs sont des composants "fixed" comme les plateaux : ils ne
// bougent pas, mais leurs deux zones + et - se cliquent
let counterBoxes: CounterBox[] = [];
const counterBoxesById = new Map<string, CounterBox>();

// mw_character components are "fixed" cards with two columns of boxes: a
// click marks a box, a double click turns the card over
let mwCharacters: MwCharacter[] = [];
const mwCharactersById = new Map<string, MwCharacter>();

// un dé se lance d'un clic : ni prenable ni déplaçable
let dices: Dice[] = [];
const dicesById = new Map<string, Dice>();
// dice_pool components: their dice are also in "dices"
let dicePools: DicePool[] = [];

// bags are "fixed" components: a released token falls into them, a click takes
// one out at random. The tokens they hold are in countersById but not in
// "counters": they are not on the table.
let bags: Bag[] = [];
const bagsById = new Map<string, Bag>();

// decks are "fixed" components too: a released card goes on top of one of
// their piles, a click takes the top card out. The cards they hold stay on
// the server. A stack is a deck of one pile that deals its cards.
let decks: Deck[] = [];
const decksById = new Map<string, Deck>();

// la situation a-t-elle déjà été lue depuis le serveur
let componentsLoaded = false;

// un spectateur regarde mais ne joue pas : pas de bouton "fixe la position"
let isWatcher = false;

// le setup du jeu, tant que le serveur ne l'a pas fait appliquer. Il attend que
// tous les composants soient a l'ecran : un pion dont l'image charge encore
// changerait de place sous les yeux du joueur.
let pendingSetup: SetupEntry[] = [];

// le setup n'est demande qu'une fois. Le serveur le vide de toute facon, mais un
// second envoi avant sa reponse ferait bouger la partie pour rien.
let setupRequested = false;

// le setup a-t-il deja ete lu dans la session ? Comme la situation initiale, il
// ne se lit qu'une fois : les messages de session suivants ne doivent pas
// re-armer la mise en place.
let setupRead = false;

function loadComponents(components: SessionComponents | undefined): void {
  // the boards of a group take its place in the drawing order
  boardGroups = [];
  boards = (components?.fixed ?? []).flatMap((item) => {
    if (item.kind === "board") return [createBoard(item as BoardItem)];
    if (item.kind === "board_group") {
      const group = createBoardGroup(item as BoardGroupItem);
      boardGroups.push(group);
      return group.boards;
    }
    return [];
  });

  counterBoxesById.clear();
  counterBoxes = (components?.fixed ?? [])
    .filter((item) => item.kind === "counter")
    .map((item) => createCounterBox(item as CounterItem));
  for (const box of counterBoxes) {
    counterBoxesById.set(box.name, box);
  }

  mwCharactersById.clear();
  mwCharacters = (components?.fixed ?? [])
    .filter((item) => item.kind === "mw_character")
    .map((item) => createMwCharacter(item as MwCharacterItem));
  for (const character of mwCharacters) {
    mwCharactersById.set(character.name, character);
  }

  countersById.clear();
  counters = (components?.movable ?? [])
    .filter((item) => item.kind === "token" || item.kind === "card")
    .map((item) => createCounter(item as TokenItem));

  for (const counter of counters) {
    countersById.set(counter.name, counter);
  }

  // the tokens of a bag are built like the others, so their pictures are
  // loaded before they come out, but they stay off the table
  bagsById.clear();
  bags = (components?.fixed ?? [])
    .filter((item) => item.kind === "bag")
    .map((item) => {
      const bag = item as BagItem;
      const content = (bag.components ?? [])
        .filter((token) => token.kind === "token")
        .map(createCounter);
      return createBag(bag, content);
    });
  for (const bag of bags) {
    bagsById.set(bag.name, bag);
    for (const counter of bag.content) {
      countersById.set(counter.name, counter);
    }
  }

  decksById.clear();
  decks = (components?.fixed ?? [])
    .filter((item) => item.kind === "deck" || item.kind === "stack" || item.kind === "slot")
    .map((item) => createDeck(item as DeckItem));
  for (const deck of decks) {
    decksById.set(deck.name, deck);
  }

  dicesById.clear();
  // the dice of a pool are drawn and clicked like the others: they are listed
  // first, the dice declared alone are drawn above them
  dicePools = (components?.fixed ?? [])
    .filter((item) => item.kind === "dice_pool")
    .map((item) => {
      const pool = item as DicePoolItem;
      return { name: pool.id, dice: (pool.dice ?? []).map(createDice) };
    })
    .filter((pool) => pool.dice.length > 0);
  dices = [
    ...dicePools.flatMap((pool) => pool.dice),
    ...(components?.dice ?? []).map((item) => createDice(item as DiceItem)),
  ];

  for (const dice of dices) {
    dicesById.set(dice.name, dice);
  }

  hand = [];
  handAnchor = null;
  stackFan = false;
  stackDrop = null;
  hoveredCounter = null;
  hoveredCounterBox = null;
  clearPending();
  cameraInitialized = false;
  setupFlipButtons();
  setupRollButtons();
}

function createCounter(token: TokenItem): Counter {
  const img = new Image();
  // the server keeps back the hidden front of a token of another nationality:
  // the back stands in for it until the token is turned over
  img.src = token.front_src ?? token.back_src ?? "";
  // la face de dos est chargée tout de suite quand le jeu en donne une :
  // un pion sans back_src ne se retourne pas, et n'a rien à précharger
  let backImg: HTMLImageElement | null = null;
  if (token.back_src) {
    backImg = new Image();
    backImg.src = token.back_src;
  }
  const counter = new Counter(
    token.id,
    img,
    // a token waiting inside a bag has no position yet
    token.x ?? 0,
    token.y ?? 0,
    token.width,
    token.height,
    token.move_border ?? true,
    // border : le jeu demande-t-il une ombre sous ce pion ?
    token.border ?? false,
    // un pion non orientable n'affiche aucune zone de rotation
    token.orientable ?? false,
    // l'angle atteint avant une sauvegarde de session, s'il y en a une
    token.orientation ?? 0,
    backImg,
    // la face affichée quand la partie a été sauvegardée en cours de jeu
    token.side ?? "front",
    // "transparent" demande d'afficher le pion fantôme sur sa case d'origine
    token.origin ?? null,
    // case de départ, celle où revient un pion déposé sur son fantôme
    // null on a token that came out of a bag: it has no starting square
    token.initial_x === undefined ? token.x : token.initial_x,
    token.initial_y === undefined ? token.y : token.initial_y,
    // où poser le fantôme. Il reprend le x/y d'origine du pion, pas celui de
    // sa case de départ : le setup et "fixe la position" déplacent la
    // deuxième, jamais le fantôme.
    token.origin_x ?? null,
    token.origin_y ?? null,
  );
  // le rectangle vert vient du serveur ; absent, un pion repositionnable
  // commence sur sa case de départ
  if (typeof token.in_place === "boolean") counter.inPlace = token.in_place;
  counter.nationality = token.nationality ?? null;
  counter.blockSight = token.block_sight === true;
  counter.isCard = token.kind === "card";
  return counter;
}

function createDice(item: DiceItem): Dice {
  return new Dice(
    item.id,
    item.x,
    item.y,
    item.width,
    item.height,
    item.src_list ?? [],
    item.src,
    item.roll_delay ?? ROLL_COOLDOWN_SECONDS,
  );
}

// -------------------------------------------------
// Retournement local d'un plateau
// -------------------------------------------------

// One button per board_group the game allows to turn over; a board alone never
// turns. The flip only changes this player's view: it is neither sent to the
// server nor shared, another screen keeps the group the way its player reads
// it. The boards of the group and everything laid on them turn together.
interface FlipPlate {
  group: BoardGroup;
  button: Button;
}

let flipPlates: FlipPlate[] = [];

function setupFlipButtons(): void {
  flipPlates = boardGroups
    .filter((group) => group.flippable && group.boards.length > 0)
    .map((group) => ({
      group,
      button: new Button(0, 0, FLIP_BUTTON_WIDTH, FLIP_BUTTON_HEIGHT, "flip", () => {
        group.flipped = !group.flipped;
        // a held token follows the pointer on screen: its logical place turns
        // with the group, otherwise it would jump to the other end of the map
        reanchorHand();
      }),
    }));
}

// Reprend les pions en main à l'endroit où ils sont dessinés, après un
// retournement. Un demi-tour est sa propre inverse : il suffit de leur donner
// pour position logique celle qui les dessine toujours au même endroit, et les
// pions restent sous le pointeur au lieu de sauter à l'autre bout du plateau.
// La translation est la même pour tous, handWorldX et handWorldY restent donc
// valides.
function reanchorHand(): void {
  for (const counter of hand) {
    const [lx, ly] = displayTopLeft(counter.x, counter.y, counter.width, counter.height);
    counter.x = lx;
    counter.y = ly;
  }
  // la barre d'info annonce la position logique du pion : elle suit le
  // retournement, sans attendre le prochain mouvement de souris
  if (hand.length > 0) counterInfoText = handInfoText();
}

// Le bouton, à sa place à l'écran. Il est reposé à chaque usage plutôt que figé
// à la création : le plateau se déplace sous lui quand la caméra zoome ou
// panoramique, et sa taille est en pixels d'écran alors que son ancre est dans
// le monde.
function placeFlipButton(plate: FlipPlate): Button {
  // top-left corner of the whole group
  const area = flipArea(plate.group);
  const [x, y] = worldToScreen(area.x, area.y);
  plate.button.x = x;
  plate.button.y = y;
  return plate.button;
}

// center of the half-turn of a group: its boards swap places as one map would
function flipCenter(group: BoardGroup): [number, number] {
  const area = flipArea(group);
  return [area.x + area.width / 2, area.y + area.height / 2];
}

// the flipped group under a point, or null. Groups do not overlap: a point
// belongs to at most one of them. The whole bounding box of the group counts,
// gaps between its boards included: that box is what the half-turn maps onto
// itself.
function flippedGroupAt(x: number, y: number): BoardGroup | null {
  for (const group of boardGroups) {
    if (!group.flipped) continue;
    const area = flipArea(group);
    if (x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height) {
      return group;
    }
  }
  return null;
}

// Turns a point by 180° around the center of the flipped group that contains
// it. Un demi-tour est sa propre inverse : la même fonction convertit un
// point de l'écran en point logique, et l'inverse.
function flipPoint(x: number, y: number): [number, number] {
  const group = flippedGroupAt(x, y);
  if (group === null) return [x, y];
  const [cx, cy] = flipCenter(group);
  return [2 * cx - x, 2 * cy - y];
}

// Screen top-left corner of a component's rectangle: when its center falls in
// a flipped group, the rectangle turns by 180° around the group's center.
// The component itself stays upright, only its place changes.
function displayTopLeft(x: number, y: number, width: number, height: number): [number, number] {
  const group = flippedGroupAt(x + width / 2, y + height / 2);
  if (group === null) return [x, y];
  const [cx, cy] = flipCenter(group);
  return [2 * cx - (x + width), 2 * cy - (y + height)];
}

// The board, as it reads on this screen. In a flipped group, it turns by 180°
// around the center of the group: its picture is upside down, and it swaps
// places with the boards opposite it.
function drawBoard(board: Board, context: CanvasRenderingContext2D): void {
  if (!board.image.complete) return;

  const { width, height } = boardDims(board);
  const group = flippedGroup(board);
  if (group === null) {
    context.drawImage(board.image, board.x, board.y, width, height);
    return;
  }

  const [cx, cy] = flipCenter(group);
  context.save();
  // half-turn around the flip center: (x, y) is drawn at (2cx - x, 2cy - y)
  context.translate(2 * cx, 2 * cy);
  context.scale(-1, -1);
  context.drawImage(board.image, board.x, board.y, width, height);
  context.restore();
}

// Dessine un composant à sa place d'écran, sans toucher au composant : sur un
// plateau retourné, son rectangle change de coin, mais l'image garde son
// orientation et l'angle d'un pion reste le sien.
function drawAtDisplay(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  draw: () => void,
): void {
  const [dx, dy] = displayTopLeft(x, y, width, height);
  if (dx === x && dy === y) {
    draw();
    return;
  }
  context.save();
  context.translate(dx - x, dy - y);
  draw();
  context.restore();
}

// Un pion à sa place d'écran. Le pion lui-même n'est pas touché : sur un plateau
// retourné, il change de coin sans pivoter, son angle reste celui que lui a
// donné le serveur.
function drawCounterAtDisplay(counter: Counter, context: CanvasRenderingContext2D = ctx): void {
  drawAtDisplay(context, counter.x, counter.y, counter.width, counter.height, () => {
    counter.draw(context);
  });
}

// -------------------------------------------------
// Hex grid
// -------------------------------------------------

// A board may declare a hex grid in its game_json: when its board_group has
// "magnetism": true, Tourtoirac snaps the center of a released token onto the nearest hex center. The client never
// moves the token itself: it outlines the hex the held token will land on, and
// the "G" key draws the whole grid, to calibrate it against the map.

// Tourtoirac's MOVE_THRESHOLD (Components/token.py): a token released this
// close to its starting square goes back there, which wins over the grid
const START_SQUARE_THRESHOLD = 30;

let showGrid = false;

// mirrors Token.near_initial_position on the server
function nearStartingSquare(counter: Counter, x: number, y: number): boolean {
  // a token that came out of a bag has no starting square
  if (counter.initialX === null || counter.initialY === null) return false;
  const dx = x - counter.initialX;
  const dy = y - counter.initialY;
  if (dx * dx + dy * dy <= START_SQUARE_THRESHOLD * START_SQUARE_THRESHOLD) return true;
  if (!counter.showsOriginGhost || counter.originX === null || counter.originY === null) return false;
  return Math.abs(x - counter.originX) < counter.width && Math.abs(y - counter.originY) < counter.height;
}

// the topmost board under a logical point, with the game_json size the server
// tests against
function topBoardAt(x: number, y: number): Board | null {
  for (let i = boards.length - 1; i >= 0; i -= 1) {
    const board = boards[i];
    if (x >= board.x && x <= board.x + board.width && y >= board.y && y <= board.y + board.height) {
      return board;
    }
  }
  return null;
}

// the board and hex center a held counter would be snapped onto if released
// now, mirroring Session.snap_to_grid on the server; null when it would not
function predictedHex(counter: Counter): { board: Board; center: [number, number] } | null {
  if (counter.moveBorder && nearStartingSquare(counter, counter.x, counter.y)) return null;
  const centerX = counter.x + counter.width / 2;
  const centerY = counter.y + counter.height / 2;
  const board = topBoardAt(centerX, centerY);
  if (board === null || board.grid === null || board.group?.magnetism !== true) return null;
  const snapped = snapToHex(board.grid, centerX - board.x, centerY - board.y);
  if (snapped === null) return null;
  return { board, center: [board.x + snapped[0], board.y + snapped[1]] };
}

// draws in the logical space of a board: in a flipped group, a half-turn
// around the group's center, like the tokens laid on it
function drawInBoardView(board: Board, context: CanvasRenderingContext2D, draw: () => void): void {
  const group = flippedGroup(board);
  if (group === null) {
    draw();
    return;
  }
  const [cx, cy] = flipCenter(group);
  context.save();
  context.translate(2 * cx, 2 * cy);
  context.scale(-1, -1);
  draw();
  context.restore();
}

// the whole grid of every board, limited to the visible part of the board
function drawGridOverlay(context: CanvasRenderingContext2D): void {
  const [viewLeft, viewTop] = screenToWorld(0, 0);
  const [viewRight, viewBottom] = screenToWorld(canvas.width, canvas.height);
  for (const board of boards) {
    const grid = board.grid;
    if (grid === null) continue;
    const { width, height } = boardDims(board);
    // a board of a flipped group shows its logical content turned around the
    // group's center
    let [left, top, right, bottom] = [viewLeft, viewTop, viewRight, viewBottom];
    const group = flippedGroup(board);
    if (group !== null) {
      const [cx, cy] = flipCenter(group);
      [left, top, right, bottom] = [2 * cx - viewRight, 2 * cy - viewBottom, 2 * cx - viewLeft, 2 * cy - viewTop];
    }
    left = Math.max(left, board.x) - board.x;
    top = Math.max(top, board.y) - board.y;
    right = Math.min(right, board.x + width) - board.x;
    bottom = Math.min(bottom, board.y + height) - board.y;
    if (left >= right || top >= bottom) continue;

    drawInBoardView(board, context, () => {
      context.save();
      context.translate(board.x, board.y);
      context.beginPath();
      traceHexesIn(context, grid, left, top, right, bottom);
      context.strokeStyle = "rgba(255, 0, 255, 0.8)";
      context.lineWidth = 1.5 / zoom;
      context.stroke();
      // the origin hex, from which the grid is measured
      context.beginPath();
      traceHex(context, grid, grid.originX, grid.originY);
      context.fillStyle = "rgba(255, 0, 255, 0.3)";
      context.fill();
      context.restore();
    });
  }
}

// outlines the hex each held counter would land on
function drawTargetHexes(context: CanvasRenderingContext2D): void {
  for (const counter of hand) {
    const target = predictedHex(counter);
    if (target === null) continue;
    const grid = target.board.grid;
    if (grid === null) continue;
    drawInBoardView(target.board, context, () => {
      context.beginPath();
      traceHex(context, grid, target.center[0], target.center[1]);
      context.fillStyle = "rgba(255, 255, 0, 0.25)";
      context.fill();
      context.strokeStyle = "rgba(255, 220, 0, 0.9)";
      context.lineWidth = 3 / zoom;
      context.stroke();
    });
  }
}

// with the grid shown, the pointer position relative to the board under it:
// what the game_json grid needs to be set from
function gridCalibrationText(): string {
  const [wx, wy] = screenToWorld(pointerScreenX, pointerScreenY);
  const [lx, ly] = flipPoint(wx, wy);
  const board = topBoardAt(lx, ly);
  if (board === null) return "Grid (G to hide)";
  return `Grid (G to hide)  ${board.name}  x=${Math.round(lx - board.x)}  y=${Math.round(ly - board.y)}`;
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, textarea, select, [contenteditable]")) return;
  if (event.key === "g" || event.key === "G") {
    showGrid = !showGrid;
  }
}

// le dé sous le pointeur, ou null : contrairement aux pions, un dé se lance
// sans être pris en main
function hitDiceAt(wx: number, wy: number): Dice | null {
  for (let i = dices.length - 1; i >= 0; i--) {
    if (dices[i].contains(wx, wy)) return dices[i];
  }
  return null;
}

function requestRoll(dice: Dice): void {
  if (dice.isLocked()) return;
  // verrou local immédiat, pour la durée annoncée par le jeu : deux clics
  // rapprochés ne doivent pas partir avant le retour du serveur
  dice.lockFor(dice.rollDelay);
  getSocket()?.send({ action: "roll", component_id: dice.name });
}

// la face tirée par un joueur, appliquée par tous les écrans
function applyRoll(message: RollEvent): void {
  const dice = dicesById.get(message.component_id);
  if (!dice) return;
  dice.roll(message.src);
  // le serveur fait foi : sa durée remplace celle qu'on s'était appliquée
  dice.lockFor(message.cooldown_seconds ?? dice.rollDelay);
}

// One button per dice_pool: it throws every dice of the pool at once. Unlike
// the flip, the throw is a move of the game: it goes through the server, which
// draws the faces and sends them to every screen.
interface RollPlate {
  pool: DicePool;
  button: Button;
}

let rollPlates: RollPlate[] = [];

function setupRollButtons(): void {
  rollPlates = dicePools.map((pool) => ({
    pool,
    button: new Button(0, 0, ROLL_BUTTON_WIDTH, ROLL_BUTTON_HEIGHT, "roll", () => {
      requestRollPool(pool);
    }),
  }));
}

// The pool is thrown as a whole: one dice still in its delay holds it all, as
// the server would refuse the throw.
function isPoolLocked(pool: DicePool): boolean {
  return pool.dice.some((dice) => dice.isLocked());
}

// The button, at its place on screen: just above the top-left corner of the
// rectangle enclosing the dice of the pool, where they are drawn. It is placed
// again at each use, as the dice move under it with the camera, the setup and
// the flip of a board_group.
function placeRollButton(plate: RollPlate): Button {
  let left = Infinity;
  let top = Infinity;
  for (const dice of plate.pool.dice) {
    const [dx, dy] = displayTopLeft(dice.x, dice.y, dice.width, dice.height);
    left = Math.min(left, dx);
    top = Math.min(top, dy);
  }
  const [x, y] = worldToScreen(left, top);
  plate.button.x = x;
  plate.button.y = y - ROLL_BUTTON_HEIGHT - ROLL_BUTTON_GAP;
  return plate.button;
}

function requestRollPool(pool: DicePool): void {
  if (isPoolLocked(pool)) return;
  // immediate local lock, as for a single dice: two quick clicks must not
  // both leave before the server answers
  for (const dice of pool.dice) dice.lockFor(dice.rollDelay);
  getSocket()?.send({ action: "roll_pool", component_id: pool.name });
}

// the faces drawn by a player for a whole pool, applied by every screen
function applyRollPool(message: RollPoolEvent): void {
  for (const entry of message.dice ?? []) {
    const dice = dicesById.get(entry.component_id);
    if (!dice) continue;
    dice.roll(entry.src);
    // the server is the reference: its delay replaces the local one
    dice.lockFor(entry.cooldown_seconds ?? dice.rollDelay);
  }
}

// le serveur fait autorité sur le rectangle vert
function applyComponentState(state: ComponentState | undefined): void {
  if (!state) return;
  const counter = countersById.get(state.id);
  if (!counter) return;
  counter.x = state.x;
  counter.y = state.y;
  if (typeof state.in_place === "boolean") counter.inPlace = state.in_place;
  // "fixe la position" déplace la case de départ, donc le retour du pion et son
  // rectangle vert. Le fantôme reste où le jeu l'a posé : originX/originY sont
  // figés à l'installation et ne se relisent pas sur un message de position.
  if (typeof state.initial_x === "number") counter.initialX = state.initial_x;
  if (typeof state.initial_y === "number") counter.initialY = state.initial_y;
}

// "Fixe la position" and "Copie d'écran" live in an optional bar under the
// header. Both options are booleans: the game hides either button with
// options.fix_positions or options.screen_capture set to false; true, or no
// option at all, shows it. A game saved before fix_positions became a boolean
// may still carry null (hidden) or a position (shown). The bar itself goes
// away when it has no button left to show.
const optionsBar = document.getElementById("options-bar");
const fixLink = document.getElementById("fix-link");
const screenshotLink = document.getElementById("screenshot-link") as HTMLButtonElement | null;

const documentsSelect = document.getElementById("documents-select") as HTMLSelectElement | null;

let fixPositionsEnabled = true;
let screenCaptureEnabled = true;
let hasDocuments = false;

// The documents of the game (PDF files) are listed in a select at the top of
// the participants panel, under a first "Consulter" entry that only serves as
// a label.
function setupDocuments(documents: SessionDocument[]): void {
  hasDocuments = documents.length > 0;
  if (!documentsSelect) return;
  // keep the "Consulter" entry, rebuild the others
  documentsSelect.length = 1;
  for (const entry of documents) {
    documentsSelect.add(new Option(entry.name, entry.src));
  }
  documentsSelect.selectedIndex = 0;
}

if (documentsSelect) {
  documentsSelect.addEventListener("change", () => {
    const src = documentsSelect.value;
    // back to "Consulter": the same document can then be opened again
    documentsSelect.selectedIndex = 0;
    if (src) window.open(src, "_blank", "noopener");
  });
}

function setupOptionsBar(session: Session | null): void {
  const fix = session?.options?.fix_positions;
  fixPositionsEnabled = fix !== null && fix !== false;
  const capture = session?.options?.screen_capture;
  screenCaptureEnabled = capture !== null && capture !== false;
  setupDocuments(session?.documents ?? []);
  updateOptionsBar();
}

function updateOptionsBar(): void {
  // moving the counters back is reserved to the players of a game still open;
  // a watcher may still take a screenshot
  const showFix = fixPositionsEnabled && !isWatcher && !isClosed;
  if (fixLink) fixLink.hidden = !showFix;
  if (screenshotLink) screenshotLink.hidden = !screenCaptureEnabled;
  updateScreenshotAvailability();
  if (documentsSelect) documentsSelect.hidden = !hasDocuments;
  if (optionsBar) optionsBar.hidden = !showFix && !screenCaptureEnabled;
}

// A capture shows the table, not a move in progress: the button is off while
// this player holds a token, and while an image is being encoded. Called every
// frame, so it only touches the DOM when the state changes.
let capturing = false;

function updateScreenshotAvailability(): void {
  if (!screenshotLink) return;
  const disabled = capturing || hand.length > 0;
  if (screenshotLink.disabled !== disabled) screenshotLink.disabled = disabled;
}

if (fixLink) {
  fixLink.addEventListener("click", () => {
    // le serveur remet le rectangle vert et prévient joueurs et spectateurs
    getSocket()?.send({ action: "fix_positions" });
  });
}

// -------------------------------------------------
// Caméra
// -------------------------------------------------

let cameraX = 0;
let cameraY = 0;
let zoom = 1.0;
let worldWidth = 0;
let worldHeight = 0;
let cameraInitialized = false;

function initializeCamera(): void {
  if (cameraInitialized) return;
  if (boards.length === 0) return;
  if (!allBoardsLoaded(boards)) return;

  worldWidth = Math.max(...boards.map((b) => b.x + boardDims(b).width));
  worldHeight = Math.max(...boards.map((b) => b.y + boardDims(b).height));

  zoom = Math.min(canvas.width / worldWidth, canvas.height / worldHeight) * 0.98;
  zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));

  cameraInitialized = true;
}

// Recentre la caméra sur un pion, sans toucher au zoom : le clic sur le
// fantôme d'un pion "transparent" y amène l'écran. On vise le centre du pion,
// pas son coin, pour qu'il tombe au milieu de la vue.
function centerCameraOn(counter: Counter): void {
  const [dx, dy] = displayTopLeft(counter.x, counter.y, counter.width, counter.height);
  cameraX = dx + counter.width / 2 - canvas.width / (2 * zoom);
  cameraY = dy + counter.height / 2 - canvas.height / (2 * zoom);
}

// -------------------------------------------------
// Following the view of another player
// -------------------------------------------------
// Each player tells the server the center of its view, while somebody
// follows it. The eye next to the
// name of another player centers the reader's view on that player's, until
// the eye is clicked again: meanwhile the camera only zooms, with the wheel.
// The center travels in logical coordinates, as a flipped board does not read
// the same on both screens.

// at most one view message per interval, and only when the view changed
const VIEW_SEND_INTERVAL_MS = 50;
// The follower's camera glides toward the last center received instead of
// jumping to it: each frame it covers the share of the gap that this time
// constant gives, whatever the frame rate. Short enough to stay close behind
// the followed player, long enough to bridge two view messages.
const FOLLOW_SMOOTHING_S = 0.08;

let followedPlayer: string | null = null;
// where the followed player looks; null until the server tells it
let followedView: [number, number] | null = null;
// the center the follower's camera shows, in logical coordinates: it trails
// followedView; null until the first view, which is shown at once
let followShown: [number, number] | null = null;
// who follows the view of the reader: it is only sent while somebody does,
// and none of them can be followed back
let followers: string[] = [];
let lastSentView: [number, number] | null = null;
let lastViewSentAt = 0;

function applyFollowed(received: string[] | undefined): void {
  followers = Array.isArray(received) ? received : [];
  // a new follower is sent the view at once, even unchanged
  lastSentView = null;
  lastViewSentAt = 0;
  // the eye of a follower is turned off, the others on
  renderParticipants();
}

function sendView(now: number): void {
  if (followers.length === 0 || isWatcher || isClosed || !cameraInitialized) return;
  if (now - lastViewSentAt < VIEW_SEND_INTERVAL_MS) return;
  const [wx, wy] = screenToWorld(canvas.width / 2, canvas.height / 2);
  const [lx, ly] = flipPoint(wx, wy);
  const x = Math.round(lx);
  const y = Math.round(ly);
  if (lastSentView !== null && lastSentView[0] === x && lastSentView[1] === y) return;
  const socket = getSocket();
  if (!socket) return;
  socket.send({ action: "view", x, y });
  lastSentView = [x, y];
  lastViewSentAt = now;
}

// keeps the center of the view on the followed one, whatever the zoom
function followView(dt: number): void {
  if (followedPlayer === null || followedView === null) {
    followShown = null;
    return;
  }
  if (followShown === null) {
    followShown = [followedView[0], followedView[1]];
  } else {
    const step = 1 - Math.exp(-dt / FOLLOW_SMOOTHING_S);
    followShown = [
      followShown[0] + (followedView[0] - followShown[0]) * step,
      followShown[1] + (followedView[1] - followShown[1]) * step,
    ];
  }
  const [dx, dy] = flipPoint(followShown[0], followShown[1]);
  cameraX = dx - canvas.width / (2 * zoom);
  cameraY = dy - canvas.height / (2 * zoom);
}

function applyView(message: ViewEvent): void {
  if (message.nickname !== followedPlayer) return;
  followedView = [message.x, message.y];
}

function stopFollowing(): void {
  if (followedPlayer === null) return;
  followedPlayer = null;
  followedView = null;
  getSocket()?.send({ action: "follow", nickname: null });
}

function toggleFollow(nickname: string): void {
  if (followedPlayer === nickname) {
    stopFollowing();
  } else {
    followedPlayer = nickname;
    followedView = null;
    // the server answers at once with the last view of that player
    getSocket()?.send({ action: "follow", nickname });
  }
  renderParticipants();
}

function followEyeButton(nickname: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "follow-eye";
  button.innerHTML = eyeIcon;
  const active = followedPlayer === nickname;
  button.classList.toggle("active", active);
  // two players never follow each other: the server would refuse it
  const followsReader = followers.includes(nickname);
  button.disabled = followsReader;
  if (followsReader) {
    button.title = `${nickname} suit déjà ta vue`;
  } else {
    button.title = active ? "Reprendre le contrôle de la caméra" : `Suivre la vue de ${nickname}`;
  }
  // the line may be dragged by the owner: the eye only toggles the following
  button.draggable = false;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFollow(nickname);
  });
  return button;
}

// -------------------------------------------------
// Défilement au bord : le pointeur, et ce qu'il garde
// -------------------------------------------------

// Où se trouve le pointeur, en pixels d'écran. Sa position est suivie même
// quand il n'a rien déclenché : un pointeur immobile n'émet aucun mousemove, et
// c'est pourtant le cas le plus courant pendant un défilement.
let edgeX = -1;
let edgeY = -1;

// options.border_shift of the game: only true turns the scrolling at the
// edges of the screen on. Without it the view only moves with the right button.
let borderShiftEnabled = false;

// Proximité d'un bord, en fraction de la vitesse maximale : 1 sur le bord
// même, 0 dès qu'on en sort. On normalise par la bande, pour que la taille de
// la fenêtre n'ait pas d'effet sur la façon dont le défilement s'enclenche.
function edgeProximity(distance: number, extent: number): number {
  if (extent <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - distance / Math.min(EDGE_BAND, extent / 2)));
}

// Proximité du bord le plus proche sur un axe, signée : positive vers la fin de
// l'axe (droite, bas), négative vers son début. Le signe est indispensable —
// être près du bord gauche et près du bord droit se ressemblent, mais on défile
// alors dans deux sens opposés. Les deux bords sont pesés puis on garde le plus
// fort : dans un coin le pointeur est près des deux, et c'est le bord qu'il
// approche qui doit décider du sens.
function edgeSignedOnAxis(position: number, extent: number): number {
  const nearStart = edgeProximity(position, extent);
  const nearEnd = edgeProximity(extent - position, extent);
  return nearStart >= nearEnd ? -nearStart : nearEnd;
}

// Le vecteur de défilement, en pixels d'écran par seconde. cameraX et cameraY
// sont les coordonnées monde du coin haut gauche de la vue : les augmenter
// déplace la vue vers l'est et vers le sud, et fait glisser la carte dans le
// sens du bord que le pointeur approche. Chaque axe ne dépend que de sa propre
// bande — un pointeur au bord droit défile droit, même s'il est aussi un peu
// plus bas.
//
// L'adoucissement porte sur la valeur absolue et le signe est remis ensuite :
// élevé à la puissance sur une valeur négative, le résultat changerait de signe
// pour un exposant impair, et le défilement partirait à l'opposé.
function edgeScrollVector(): [number, number] {
  const eased = (fraction: number): number =>
    Math.sign(fraction) * Math.abs(fraction) ** EDGE_EASE * EDGE_SCROLL_SPEED;
  return [
    eased(edgeSignedOnAxis(edgeX, canvas.width)),
    eased(edgeSignedOnAxis(edgeY, canvas.height)),
  ];
}

// Fait défiler la caméra d'un cran. Le mouvement est exprimé en pixels d'écran
// puis divisé par le zoom : la caméra avance d'autant de pixels du monde que la
// vue en fait, et le défilement garde donc la même vitesse à tous les zooms.
//
// La main est laissée en place, et c'est tout l'intérêt du geste : le pion suit
// le pointeur, donc le monde, au lieu de rester collé à sa case d'origine. On
// ne translate la main que si elle est pleine — un pointeur qui traîne au bord
// avec la main vide ne doit pas secouer des pions que personne ne tient.
function stepEdgeScroll(dt: number): void {
  if (!borderShiftEnabled || !edgeScrolling()) return;
  // the view of the followed player moves the camera
  if (followedPlayer !== null) return;

  const [vx, vy] = edgeScrollVector();
  if (vx === 0 && vy === 0) return;

  cameraX += (vx * dt) / zoom;
  cameraY += (vy * dt) / zoom;

  // a hand the button does not hold stays where it is, as in onMouseMove
  if (hand.length === 0 || !dragging) return;

  // La position de la main se déduit du pointeur, pas du temps : sinon le pion
  // se déplacerait deux fois, une fois avec la carte et une fois avec la souris.
  // lastMouseWorld est réécrit ici, donc la main ne part pas à la dérive.
  const [wx, wy] = screenToWorld(edgeX, edgeY);
  const [lx, ly] = flipPoint(wx, wy);
  lastMouseWorldX = lx;
  lastMouseWorldY = ly;
  for (const counter of hand) {
    counter.x = lx;
    counter.y = ly;
  }
  // a carried stack keeps its fanned shape
  fanStack();
  handWorldX = lx;
  handWorldY = ly;
  movesDirty = true;
  counterInfoText = handInfoText();
}

// -------------------------------------------------
// Main : composants attachés par le serveur
// -------------------------------------------------

let hand: Counter[] = [];
let handAnchor: Counter | null = null;
type PendingAction = "acquire" | "release" | "pick" | "take" | "draw";
// requestId: set for a pick, whose answer names the token, not the bag, and
// for a take
let pending: { action: PendingAction; componentId: string; requestId?: string } | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

let handWorldX = 0;
let handWorldY = 0;
let lastMouseWorldX = 0;
let lastMouseWorldY = 0;

// Drag and drop: the left button going down on a token takes it in hand, the
// hand follows the pointer while the button stays down, and the button coming
// up puts it down. `dragging` is that button state, as far as the hand goes.
let dragging = false;

// The button came up before the server answered the acquire or the pick: the
// token is put down as soon as it arrives in the hand.
let releaseOnArrival = false;

// The token the button went down on, and where: its acquire is answered a
// moment later, and the token then catches up with the pointer.
let grabbedName: string | null = null;
let grabWorldX = 0;
let grabWorldY = 0;

// Long press: the button stays down on a stack without moving, and every
// token under the press point joins the hand. They then move and are put down
// together.
const LONG_PRESS_MS = 500;
// the pointer may tremble this much, in screen pixels, and still be "not moving"
const LONG_PRESS_SLACK = 6;
let longPressTimer: ReturnType<typeof setTimeout> | null = null;
let pressScreenX = 0;
let pressScreenY = 0;

// The 1 / 5 / 10 button of a pile the left button went down on, and where on
// screen. The cards are only asked for once the pointer moves away with the
// button still down: a simple click draws nothing.
let armedDraw: DrawButton | null = null;
let armedDrawScreenX = 0;
let armedDrawScreenY = 0;

// The mw_character the left button went down on, while cards lie under it,
// and where on screen. Its last card is only asked for once the pointer moves
// away with the button still down: a click, or a double click that turns the
// character over, takes nothing.
let armedCharacter: MwCharacter | null = null;
let armedCharacterScreenX = 0;
let armedCharacterScreenY = 0;

// The request of a draw of several cards: one event answers for each card,
// while `pending` only waits for the first.
let multiDrawId: string | null = null;
let multiDrawTimer: ReturnType<typeof setTimeout> | null = null;
// how far apart, in world pixels, the cards of one draw lie in the hand;
// mirrors DRAW_FAN on the server
const DRAW_FAN = 20;

function clearMultiDraw(): void {
  multiDrawId = null;
  if (multiDrawTimer !== null) {
    clearTimeout(multiDrawTimer);
    multiDrawTimer = null;
  }
}

// Tokens asked for by a long press, whose acquire is not answered yet. They
// are several at once, so `pending`, which follows one request, cannot tell
// their answers from another player's.
const stackRequests = new Set<string>();
let stackRequestsTimer: ReturnType<typeof setTimeout> | null = null;

// A stack taken by a long press is drawn fanned out while it is carried, each
// token a little lower and to the right of the one above it, so that it looks
// like a pile. It is put down gathered again, every token centered on the top
// one (the anchor of the hand).
const STACK_FAN_STEP = 4;
// beyond this depth, the lower tokens stay under the last visible step
const STACK_FAN_MAX = 8;
let stackFan = false;
// center of the top token when the stack was put down: a token of the stack
// whose acquire is answered after the button came up (one of ids) is put down
// there too
let stackDrop: { x: number; y: number; ids: Set<string> } | null = null;

// Places every token of a carried stack relative to the top one: depth 0 is
// the anchor, then one step per token below it. gathered puts them all on the
// anchor, as they are put down.
function fanStack(gathered = false): void {
  const anchor = handAnchor;
  if (!stackFan || anchor === null || !hand.includes(anchor)) return;
  const centerX = anchor.x + anchor.width / 2;
  const centerY = anchor.y + anchor.height / 2;
  // the hand is sorted bottom first: the last tokens are the highest
  const others = hand.filter((counter) => counter !== anchor);
  others.forEach((counter, index) => {
    const depth = gathered ? 0 : Math.min(others.length - index, STACK_FAN_MAX);
    counter.x = centerX - counter.width / 2 + depth * STACK_FAN_STEP;
    counter.y = centerY - counter.height / 2 + depth * STACK_FAN_STEP;
  });
  movesDirty = true;
}

function cancelLongPress(): void {
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function armLongPress(sx: number, sy: number): void {
  cancelLongPress();
  pressScreenX = sx;
  pressScreenY = sy;
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    grabStack();
  }, LONG_PRESS_MS);
}

// The long press is confirmed: asks for every other token lying under the
// point where the button went down. The top one is already in hand, or on its
// way: it was asked for when the button went down.
function grabStack(): void {
  if (!dragging || isWatcher) return;
  // the token under the pointer was refused: nothing leaves without it
  if (hand.length === 0 && pending?.action !== "acquire") return;
  const socket = getSocket();
  if (!socket) return;

  const stack = countersAt(grabWorldX, grabWorldY).filter(
    (counter) =>
      !hand.includes(counter) &&
      counter.name !== grabbedName &&
      counter.heldBy === null &&
      canAcquire(counter),
  );
  if (stack.length === 0) return;
  stackFan = true;
  stackDrop = null;

  for (const counter of stack) {
    stackRequests.add(counter.name);
    const message = { action: "acquire", component_id: counter.name };
    socket.send(message);
    console.log("[WS] Envoyé :", JSON.stringify(message));
  }
  // an acquire refused by an error event names no token: the requests left
  // unanswered are forgotten, so that they never match a later acquire
  if (stackRequestsTimer !== null) clearTimeout(stackRequestsTimer);
  stackRequestsTimer = setTimeout(() => {
    stackRequests.clear();
    stackRequestsTimer = null;
    stackDrop = null;
  }, RESPONSE_TIMEOUT);
}

// The hand is kept in drawing order, bottom first: a stack taken in hand is
// drawn, and later put down, in the order it had on the table.
function sortHand(): void {
  hand.sort((a, b) => counters.indexOf(a) - counters.indexOf(b));
}

// la main reste verrouillée tant que le serveur n'a pas répondu
function setPending(action: PendingAction, componentId: string, requestId?: string): void {
  clearPending();
  pending = { action, componentId, requestId };
  pendingTimer = setTimeout(() => {
    console.warn("[WS] Aucune réponse du serveur pour", action, componentId);
    clearPending();
  }, RESPONSE_TIMEOUT);
}

function clearPending(): void {
  pending = null;
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
}

// Les nouvelles positions de la main sont diffusées aux autres joueurs :
// un message par composant et par image au plus.
let movesDirty = false;

function flushMoves(): void {
  if (!movesDirty || hand.length === 0) return;
  movesDirty = false;

  const socket = getSocket();
  if (!socket) return;

  for (const counter of hand) {
    socket.send({
      action: "move",
      component_id: counter.name,
      x: counter.x,
      y: counter.y,
    });
  }
}

// Un pion relâché repasse en fin de liste : il se dessine alors au-dessus des
// pions de la pile qu'il vient de rejoindre. L'ordre reste le même pour tous,
// puisque le serveur diffuse le relâchement à toute la session.
function bringCounterToFront(counter: Counter): void {
  const index = counters.indexOf(counter);
  if (index === -1 || index === counters.length - 1) return;
  counters.splice(index, 1);
  counters.push(counter);
}

// Le serveur accuse réception de chaque acquisition / relâchement :
// la main est reconstruite à partir de ces accusés, un composant à la fois.
function applyHandEvent(answer: HandEvent, isOwnRequest: boolean, fromStack = false): void {
  const counter = countersById.get(answer.component_id);
  if (!counter) {
    console.warn("[hand] Composant inconnu :", answer.component_id);
    return;
  }

  // identité du détenteur, pour tous les joueurs de la session
  counter.heldBy = answer.event === "acquire" ? answer.user : null;

  // au lâcher, Tourtoirac renvoie la position validée : c'est elle qui fait
  // réapparaître le pion chez les autres joueurs, à l'endroit réel.
  // Le rectangle vert voyage dans le même message.
  if (answer.event === "release") {
    const release = answer as ReleaseEvent;
    setHands(release.hands);
    if (release.hand_of) {
      // the holder of the hand receives the front of a card that was lying
      // on its back; the others receive nothing new
      const kept = release.component_json as Partial<TokenItem> | undefined;
      if (kept) counter.setFaces(kept.front_src, kept.back_src);
      // a card joins a hand face up, whatever side it showed on the table
      if (kept?.side !== undefined) counter.setSide(kept.side);
      // and upright, whatever angle it had on the table
      if (typeof kept?.orientation === "number") counter.orientation = kept.orientation;
      // the token went to the private hand of a player: it leaves the table
      putInPrivateHand(counter, release.hand_of);
    } else if (release.deck_id) {
      // the card went on top of a pile of a deck: it leaves the table
      putInBag(counter, undefined);
      refreshDeck(release.deck_json);
    } else if (release.character_id) {
      // the card went under an mw_character: it leaves the table
      putInBag(counter, undefined);
      refreshCharacter(release.character_json);
    } else if (release.bag_id) {
      // the token fell into a bag: it leaves the table
      putInBag(counter, bagsById.get(release.bag_id));
    } else {
      applyComponentState(release.component_json);
      bringCounterToFront(counter);
    }
  }

  // les messages des autres joueurs sont affichés plus tard. A release of a
  // token of this hand always empties it, whoever the answer is matched to:
  // the server no longer holds it for this player.
  const leavesHand = answer.event === "release" && hand.includes(counter);
  if (!isOwnRequest && !leavesHand) return;

  if (answer.event === "acquire") {
    if (hand.includes(counter)) return;

    counter.held = true;
    hand.push(counter);
    sortHand();

    if (fromStack) {
      // a token of a long press: the token the button went down on stays the
      // anchor of the hand
      if (!dragging) {
        // the button is already up: the token goes straight back down, on
        // the rest of the stack when it was put down already
        if (stackDrop?.ids.has(counter.name)) {
          counter.x = stackDrop.x - counter.width / 2;
          counter.y = stackDrop.y - counter.height / 2;
        }
        requestRelease(counter);
      } else {
        // the stack follows the token that left first
        counter.x += lastMouseWorldX - grabWorldX;
        counter.y += lastMouseWorldY - grabWorldY;
        movesDirty = true;
        fanStack();
      }
    } else {
      handAnchor = counter;
      if (releaseOnArrival) {
        // the button is already up: the token goes straight back down
        releaseOnArrival = false;
        requestRelease(counter);
      } else if (dragging && grabbedName === counter.name) {
        // the pointer moved while the server was answering
        counter.x += lastMouseWorldX - grabWorldX;
        counter.y += lastMouseWorldY - grabWorldY;
        movesDirty = true;
        // tokens of the stack may have arrived before the top one
        fanStack();
      }
      grabbedName = null;
    }
  } else {
    const index = hand.indexOf(counter);
    if (index >= 0) hand.splice(index, 1);
    counter.held = false;
    if (handAnchor === counter) handAnchor = hand[0] ?? null;
    if (hand.length === 0) stackFan = false;

    // pas de recalage ici : il a été fait avant l'envoi du release, et
    // applyComponentState a posé la position renvoyée par le serveur
  }

  if (hand.length > 0) {
    // la main se recale sur la position courante de la souris
    handWorldX = lastMouseWorldX;
    handWorldY = lastMouseWorldY;
    counterInfoText = handInfoText();
  } else {
    counterInfoText = counterPositionText(counter);
  }
}

// A token released over a bag joins its content: it is no longer drawn nor
// clickable, until the server picks it again.
function putInBag(counter: Counter, bag: Bag | undefined): void {
  const index = counters.indexOf(counter);
  if (index >= 0) counters.splice(index, 1);
  if (hoveredCounter === counter) hoveredCounter = null;
  counter.inPlace = false;
  counter.initialX = null;
  counter.initialY = null;
  if (bag !== undefined && !bag.content.includes(counter)) bag.content.push(counter);
}

// The client only says which bag it clicked and where: the server chooses the
// token at random and puts it in the hand of the player.
function requestPick(bag: Bag, x: number, y: number): void {
  // an empty bag has nothing to give: the server would refuse anyway
  if (bag.content.length === 0) return;
  // the server only draws among the tokens this player may take
  if (!bag.content.some(canAcquire)) {
    showInfoMessage("Aucun pion de votre nationalité dans ce sac");
    return;
  }
  if (!isStarted) {
    warnGameNotStarted();
    return;
  }
  if (missingPlayers.length > 0) {
    warnPlayersMissing();
    return;
  }
  const socket = getSocket();
  if (!socket) return;

  // two players may pick from the same bag at once: the id tells this
  // request's answer from the other player's
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const message = { action: "pick", component_id: bag.name, x, y, request_id: requestId };
  setPending("pick", bag.name, requestId);
  socket.send(message);
  console.log("[WS] Envoyé :", JSON.stringify(message));
}

// The server described a deck again: a card joined or left one of its piles,
// or a pile was shuffled.
function refreshDeck(item: DeckItem | null | undefined): void {
  if (!item) return;
  const deck = decksById.get(item.id);
  if (deck !== undefined) updateDeck(deck, item);
}

// The client only says which pile it clicked, where, and how many cards it
// wants: the server takes them from the top and puts them in the hand of the
// player.
function requestDraw(deck: Deck, pile: DeckPile, x: number, y: number, count = 1): void {
  // an empty pile has nothing to give: the server would refuse anyway
  if (pile.count === 0) return;
  if (!isStarted) {
    warnGameNotStarted();
    return;
  }
  if (missingPlayers.length > 0) {
    warnPlayersMissing();
    return;
  }
  const socket = getSocket();
  if (!socket) return;

  // two players may draw from the same pile at once: the id tells this
  // request's answer from the other player's
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const message = {
    action: "draw",
    component_id: deck.name,
    pile: pile.name,
    count,
    x,
    y,
    request_id: requestId,
  };
  setPending("draw", deck.name, requestId);
  clearMultiDraw();
  if (count > 1) {
    // the cards after the first are recognised by this id
    multiDrawId = requestId;
    multiDrawTimer = setTimeout(clearMultiDraw, RESPONSE_TIMEOUT);
  }
  socket.send(message);
  console.log("[WS] Envoyé :", JSON.stringify(message));
}

// The number of players a stack deals to, one card each: every seat of the
// game. Null when the game has no private hand: nothing can be dealt.
function dealPlayers(): number | null {
  if (!privateHandEnabled) return null;
  return participants.filter((entry) => entry.role === "player").length;
}

// A click on a button of a deck: shuffle a pile, put the discard pile back
// into the draw pile, or deal a stack. The server answers the whole session
// with the deck.
function requestDeckAction(button: DeckButton): void {
  if (!button.enabled) {
    showInfoMessage("Pas assez de cartes pour en donner une à chaque joueur");
    return;
  }
  if (!isStarted) {
    warnGameNotStarted();
    return;
  }
  if (missingPlayers.length > 0) {
    warnPlayersMissing();
    return;
  }
  const socket = getSocket();
  if (!socket) return;
  const message = { action: button.action, component_id: button.deck.name, pile: button.pile.name };
  socket.send(message);
  console.log("[WS] Envoyé :", JSON.stringify(message));
}

// A pile was shuffled or the discard pile went back to the draw: every screen
// reads the deck again and says who did it.
function applyDeckEvent(message: DeckEvent): void {
  refreshDeck(message.deck_json);
  const who = message.nickname ?? "Un joueur";
  const what =
    message.event === "refill"
      ? "a remis la défausse dans la pioche"
      : `a mélangé ${message.pile === "discard" ? "la défausse" : "la pioche"}`;
  showInfoMessage(`${who} ${what}`);
}

// A stack dealt one card to each player: every screen reads the stack and the
// hands again, and the reader gets its own card in its private hand.
function applyDeal(message: DealEvent): void {
  refreshDeck(message.deck_json);
  setHands(message.hands);
  for (const card of message.cards ?? []) {
    let counter = countersById.get(card.id);
    if (counter === undefined) {
      // the cards of a stack stay on the server until they leave it
      counter = createCounter(card);
      countersById.set(counter.name, counter);
    }
    counter.setFaces(card.front_src, card.back_src);
    if (card.side !== undefined) counter.setSide(card.side);
    if (!myHand.includes(counter)) myHand.push(counter);
  }
  renderPrivateHand();
  showInfoMessage(`${message.nickname ?? "Un joueur"} a distribué une carte à chaque joueur`);
}

// A token came out of a bag, of a deck or of the private hand of a player,
// applied by every screen: it is back on the table, above the others, in the
// mouse hand of the player who picked it.
function applyPick(message: PickEvent | TakeEvent | DrawEvent): void {
  // a card of a draw of several, after the first one: `pending` is already
  // answered, the request id alone tells it is ours
  const drawIndex = message.event === "draw" ? (message.index ?? 0) : 0;
  const laterCard =
    message.event === "draw" &&
    drawIndex > 0 &&
    multiDrawId !== null &&
    multiDrawId === message.request_id;
  const isOwnRequest =
    laterCard ||
    (pending?.action === message.event &&
      pending.requestId !== undefined &&
      pending.requestId === message.request_id);
  if (isOwnRequest && !laterCard) clearPending();
  if (laterCard && drawIndex >= (message as DrawEvent).count! - 1) clearMultiDraw();
  if (message.event === "take") setHands(message.hands);
  if (message.event === "draw") refreshDeck(message.deck_json);
  if (message.event === "pick") refreshCharacter(message.character_json);

  const state = message.component_json;
  if (!state) return;

  let counter = countersById.get(state.id);
  if (counter === undefined) {
    // a token this screen never heard of: built from what the server sends
    counter = createCounter(state);
    countersById.set(counter.name, counter);
  }
  const picked = counter;
  for (const bag of bags) {
    bag.content = bag.content.filter((candidate) => candidate !== picked);
  }
  if (myHand.includes(picked)) {
    myHand = myHand.filter((candidate) => candidate !== picked);
    renderPrivateHand();
  }

  counter.x = state.x ?? 0;
  counter.y = state.y ?? 0;
  counter.inPlace = false;
  counter.initialX = state.initial_x ?? null;
  counter.initialY = state.initial_y ?? null;
  counter.setFaces(state.front_src, state.back_src);
  if (state.side !== undefined) counter.setSide(state.side);
  // a card drawn comes out upright (orientation 0 from the server)
  if (typeof state.orientation === "number") counter.orientation = state.orientation;
  if (!counters.includes(counter)) counters.push(counter);

  if (isOwnRequest) {
    // the pointer may have moved since the button went down: the token comes
    // out under it, and is put down where the button comes up
    // the cards of one draw lie side by side, so the player sees them all
    counter.x = lastMouseWorldX - counter.width / 2 + drawIndex * DRAW_FAN;
    counter.y = lastMouseWorldY - counter.height / 2;
    movesDirty = true;
  }
  if (laterCard) {
    // the card joins the hand like a token of a long press, already under
    // the pointer: it has nothing to catch up with
    grabWorldX = lastMouseWorldX;
    grabWorldY = lastMouseWorldY;
  }

  // from here on, the token is taken in hand like one acquired on the table
  applyHandEvent(
    { event: "acquire", component_id: counter.name, user: message.user, success: true },
    isOwnRequest,
    laterCard,
  );
}

// -------------------------------------------------
// Souris
// -------------------------------------------------

// MouseEvent.button values, and the MouseEvent.buttons bit of the right button
const MOUSE_LEFT = 0;
const MOUSE_RIGHT = 2;
const MOUSE_LEFT_MASK = 1;
const MOUSE_RIGHT_MASK = 2;

let lastMouseX = 0;
let lastMouseY = 0;
// the camera follows the pointer while the right button is held down
let panning = false;
// the id and the position of the token in hand or just released: it stays in
// the info bar, and only when the game shows the ids (counterPositionText,
// handInfoText)
let counterInfoText = "";

// Any other message of the info bar shows over it, and the bar goes away
// INFO_MESSAGE_MS after the last one, back to the position of the token if
// the game shows the ids.
const INFO_MESSAGE_MS = 5000;
let infoMessage = "";
let infoMessageUntil = 0;

function showInfoMessage(text: string): void {
  infoMessage = text;
  infoMessageUntil = performance.now() + INFO_MESSAGE_MS;
}

// options.component_id_display of the game: false hides the name and the
// position of the tokens in the info bar. Absent, they are shown as before.
let showComponentId = true;

function counterPositionText(counter: Counter): string {
  if (!showComponentId) return "";
  return `${counter.name}  x=${Math.floor(counter.x)}  y=${Math.floor(counter.y)}`;
}

function handInfoText(): string {
  const anchor = handAnchor ?? hand[0];
  if (!anchor || !showComponentId) return "";
  const label = hand.length > 1 ? `${anchor.name} +${hand.length - 1}` : anchor.name;
  return `${label}  x=${Math.floor(anchor.x)}  y=${Math.floor(anchor.y)}`;
}

function screenToWorld(sx: number, sy: number): [number, number] {
  return [cameraX + sx / zoom, cameraY + sy / zoom];
}

// l'inverse : le point du monde tel qu'il apparaît à l'écran. Sert aux boutons
// "flip", ancrés au plateau mais dessinés en pixels d'écran.
function worldToScreen(wx: number, wy: number): [number, number] {
  return [(wx - cameraX) * zoom, (wy - cameraY) * zoom];
}

function hitCounter(wx: number, wy: number): Counter | null {
  for (let i = counters.length - 1; i >= 0; i -= 1) {
    if (counters[i].contains(wx, wy)) {
      return counters[i];
    }
  }
  return null;
}

// le pion "transparent" dont le fantôme est sous le pointeur, ou null. Le
// fantôme est dessiné sous les pions ; un pion réel au même endroit est donc
// traité avant lui, pour ne pas voler le clic qui visait ce pion.
function hitOriginGhost(wx: number, wy: number): Counter | null {
  for (let i = counters.length - 1; i >= 0; i -= 1) {
    if (counters[i].originGhostContains(wx, wy)) {
      return counters[i];
    }
  }
  return null;
}

// le pion sous le pointeur : ses zones de rotation ne s'affichent que pour
// celui-là, et seulement si la main est vide
let hoveredCounter: Counter | null = null;

// le compteur survolé : ses zones + et - ne s'affichent que pour lui, et
// seulement si la main est vide, comme les zones de rotation d'un pion
let hoveredCounterBox: CounterBox | null = null;

// Le client ne demande qu'un cran : la nouvelle valeur vient du serveur, qui
// refuse qu'un joueur choisisse le score lui-même.
function requestCounterValue(box: CounterBox, action: CounterAction): void {
  const socket = getSocket();
  if (!socket) return;

  const message = { action, component_id: box.name };
  socket.send(message);
  console.log("[WS] Envoyé :", JSON.stringify(message));
}

function applyCounterValue(message: CounterValueEvent): void {
  const box = counterBoxesById.get(message.component_id);
  if (!box) return;
  box.value = message.value;
}

// Mirrors refuse_modification for an mw_character: only the players of its
// nationality mark it or turn it over, once the game is on.
// Returns true when the action must not be sent; the player is told why.
function characterRefused(character: MwCharacter): boolean {
  if (character.nationality !== null && character.nationality !== myNationality) {
    showInfoMessage(
      showComponentId
        ? `${character.name}  réservé à ${character.nationality}`
        : `Carte réservée à ${character.nationality}`,
    );
    return true;
  }
  if (!isStarted) {
    warnGameNotStarted();
    return true;
  }
  if (missingPlayers.length > 0) {
    warnPlayersMissing();
    return true;
  }
  return false;
}

// The client only says which box was clicked: the server moves it on to its
// next state and tells every screen.
function requestMark(character: MwCharacter, column: "left" | "right", index: number): void {
  if (characterRefused(character)) return;
  const socket = getSocket();
  if (!socket) return;
  const message = { action: "mark", component_id: character.name, column, index };
  socket.send(message);
  console.log("[WS] Envoyé :", JSON.stringify(message));
}

function applyMark(message: MarkEvent): void {
  const column = mwCharactersById.get(message.component_id)?.columns[message.column];
  if (!column || message.index < 0 || message.index >= column.boxes) return;
  column.marks[message.index] = message.value;
}

// The server described a character again: a card went under it or left it.
function refreshCharacter(item: MwCharacterItem | null | undefined): void {
  if (!item) return;
  const character = mwCharactersById.get(item.id);
  if (character !== undefined) character.cards = readCharacterCards(item.cards);
}

// The last card put under a character comes out under the pointer, in the
// hand of this player, like a token picked from a bag.
function requestCharacterPick(character: MwCharacter, x: number, y: number): void {
  if (character.cards.length === 0 || characterRefused(character)) return;
  const socket = getSocket();
  if (!socket) return;
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const message = { action: "pick", component_id: character.name, x, y, request_id: requestId };
  setPending("pick", character.name, requestId);
  socket.send(message);
  console.log("[WS] Envoyé :", JSON.stringify(message));
}

function requestCharacterFlip(character: MwCharacter): void {
  if (!isFlippable(character) || characterRefused(character)) return;
  const socket = getSocket();
  if (!socket) return;
  const message = { action: "flip", component_id: character.name };
  socket.send(message);
  console.log("[WS] Envoyé :", JSON.stringify(message));
}

function requestRotate(counter: Counter, direction: RotationDirection): void {
  if (modificationRefused(counter)) return;
  const socket = getSocket();
  if (!socket) return;

  // pas de rotation optimiste : on attend l'angle que le serveur renvoie. S'il
  // refuse (pion en main, jeu qui l'interdit), l'écran ne doit pas mentir sur
  // un angle que personne d'autre ne partage
  const message = { action: "rotate", component_id: counter.name, direction };
  socket.send(message);
  console.log("[WS] Envoyé :", JSON.stringify(message));
}

// le pion a tourné : appliqué par tous les écrans, comme le lancer du dé
function applyRotate(message: RotateEvent): void {
  const counter = countersById.get(message.component_id);
  if (!counter) return;
  counter.orientation = message.orientation;
}

function requestFlip(counter: Counter): void {
  const socket = getSocket();
  if (!socket) return;

  // un pion qui n'a qu'une seule face ne se retourne pas, et on ne le demande
  // même pas au serveur : le double-clic doit rester sans effet
  if (!counter.flippable) return;
  if (modificationRefused(counter)) return;

  // pas de retournement optimiste : on attend la face que le serveur renvoie,
  // comme pour la rotation. Sinon l'écran qui a cliqué montrerait un pion que
  // les autres ne voient pas encore
  const message = { action: "flip", component_id: counter.name };
  socket.send(message);
  console.log("[WS] Envoyé :", JSON.stringify(message));
}

// A double click on a token of the private hand turns it over there. Only the
// holder sees it: the server answers this screen alone. The token will be
// played on the side it shows in the hand.
function requestHandFlip(counter: Counter): void {
  const socket = getSocket();
  if (!socket || !counter.flippable) return;
  const message = { action: "flip", component_id: counter.name };
  socket.send(message);
  console.log("[WS] Envoyé :", JSON.stringify(message));
}

// The icon left of the strip turns over every card the strip shows, each one
// on its own: a flip per card, answered to this screen alone like a double
// click. A card shown to other players stays as it is.
function requestHandFlipAll(): void {
  const shownIds = myShownIds();
  for (const counter of myHand) {
    if (!shownIds.has(counter.name)) requestHandFlip(counter);
  }
}

if (flipHandButton) {
  flipHandButton.style.backgroundImage = `url("${flipHandIcon}")`;
  flipHandButton.addEventListener("click", requestHandFlipAll);
}

// A token of the strip, or of the area the reader shows, released on the name
// of another player: it goes straight into that hand.
function requestGive(counter: Counter, nickname: string): void {
  if (!isStarted) {
    warnGameNotStarted();
    return;
  }
  if (missingPlayers.length > 0) {
    warnPlayersMissing();
    return;
  }
  const socket = getSocket();
  if (!socket) return;
  const message = { action: "give", component_id: counter.name, to: nickname };
  socket.send(message);
  console.log("[WS] Envoyé :", JSON.stringify(message));
}

// A token went from one private hand to another: the counts change for
// everyone, the strip of the giver and of the receiver too.
function applyGive(message: GiveEvent): void {
  setHands(message.hands);
  const counter = countersById.get(message.component_id);
  if (!counter) return;
  const me = loadPlayerIdentity()?.name;
  if (message.nickname === me) {
    myHand = myHand.filter((candidate) => candidate !== counter);
  }
  if (message.to === me) {
    // the receiver reads the face of the card it was given
    const given = message.component_json;
    if (given) {
      counter.setFaces(given.front_src, given.back_src);
      if (given.side !== undefined) counter.setSide(given.side);
    }
    if (!myHand.includes(counter)) myHand.push(counter);
  }
  renderPrivateHand();
}

// le pion s'est retourné : appliqué par tous les écrans, comme la rotation
function applyFlip(message: FlipEvent): void {
  // an mw_character turned over: its columns only show on its front
  const character = mwCharactersById.get(message.component_id);
  if (character !== undefined) {
    character.side = message.side;
    return;
  }
  const counter = countersById.get(message.component_id);
  if (!counter) return;
  // the face now shown may be one the server had kept back until this flip
  counter.setFaces(message.front_src, message.back_src);
  counter.setSide(message.side);
  // a token of the private hand was turned over there: the strip shows it
  if (myHand.includes(counter)) {
    renderPrivateHand();
    renderShowZones();
  }
}

// A token that belongs to a nationality is only taken by a player of that
// nationality. The server enforces it: the page only spares a doomed request.
function canAcquire(counter: Counter): boolean {
  return counter.nationality === null || counter.nationality === myNationality;
}

// Mirrors refuse_modification on the server: the rules that forbid taking a
// token in hand forbid turning it and flipping it too. A new rule goes here,
// and applies to the three actions at once.
// Returns true when the action must not be sent; the player is told why.
function modificationRefused(counter: Counter): boolean {
  if (!canAcquire(counter)) {
    // said in the info bar rather than in a window: a click on a token of
    // another side is common on a crowded map
    // the refusal is always said; the name of the token only when the game shows it
    showInfoMessage(
      showComponentId
        ? `${counter.name}  réservé à ${counter.nationality}`
        : `Pion réservé à ${counter.nationality}`,
    );
    return true;
  }
  if (!isStarted) {
    warnGameNotStarted();
    return true;
  }
  if (missingPlayers.length > 0) {
    warnPlayersMissing();
    return true;
  }
  return false;
}

// Returns true when the request was sent.
function requestAcquire(counter: Counter): boolean {
  if (modificationRefused(counter)) return false;
  const socket = getSocket();
  if (!socket) return false;

  const message = { action: "acquire", component_id: counter.name };
  setPending("acquire", counter.name);
  socket.send(message);
  console.log("[WS] Envoyé :", JSON.stringify(message));
  return true;
}

// toHand: the token is released over the private hand of the player, and the
// server keeps it there instead of putting it down.
// pile: the pile the card must join, whatever lies under its own center
function requestRelease(
  counter: Counter,
  toHand = false,
  pile: { deck: Deck; pile: DeckPile } | null = null,
  toPlayer: string | null = null,
): void {
  const socket = getSocket();
  if (!socket) return;

  // on envoie la position brute du dépôt : c'est le serveur qui décide du
  // recadrage et du rectangle vert, puis qui renvoie l'état corrigé.
  // A card sent to a pile is sent centered on it: the server puts a card in
  // the pile its center lies on.
  const message = {
    action: "release",
    component_id: counter.name,
    x: pile ? pile.pile.x + (pile.deck.width - counter.width) / 2 : counter.x,
    y: pile ? pile.pile.y + (pile.deck.height - counter.height) / 2 : counter.y,
    ...(toHand ? { hand: true } : {}),
    // the hand of another player, the token being released on its name
    ...(toHand && toPlayer !== null ? { to_player: toPlayer } : {}),
  };
  setPending("release", counter.name);
  socket.send(message);
  console.log("[WS] Envoyé :", JSON.stringify(message));
}

// The pile a group of cards in hand joins as a whole: the one under the
// pointer, else the one most of the cards hover over. A single card keeps the
// rule of its center: null.
function groupTargetPile(): { deck: Deck; pile: DeckPile } | null {
  const cards = hand.filter((counter) => counter.isCard);
  if (cards.length < 2) return null;
  const underPointer = pileAt(decks, lastMouseWorldX, lastMouseWorldY);
  if (underPointer !== null) return underPointer;
  let best: { deck: Deck; pile: DeckPile } | null = null;
  let bestVotes = 0;
  const votes = new Map<DeckPile, number>();
  for (const card of cards) {
    const found = pileAt(decks, card.x + card.width / 2, card.y + card.height / 2);
    if (found === null) continue;
    const count = (votes.get(found.pile) ?? 0) + 1;
    votes.set(found.pile, count);
    if (count > bestVotes) {
      best = found;
      bestVotes = count;
    }
  }
  return best;
}

// The left button came up: whatever is in hand is put down where it is, or
// kept in the private hand when the button came up over it (toHand).
function dropHand(toHand = false, toPlayer: string | null = null): void {
  cancelLongPress();
  if (!dragging) return;
  dragging = false;

  if (hand.length > 0) {
    // The token the button went down on may still be on its way while others
    // are already here. The releases below take over `pending`: its answer is
    // then recognised like a late token of the stack, and put down on arrival.
    if (pending?.action === "acquire") stackRequests.add(pending.componentId);
    // a carried stack is put down gathered on its top token
    if (stackFan && handAnchor !== null && hand.includes(handAnchor)) {
      fanStack(true);
      stackDrop = {
        x: handAnchor.x + handAnchor.width / 2,
        y: handAnchor.y + handAnchor.height / 2,
        ids: new Set(stackRequests),
      };
    }
    // a group of cards goes into one pile together, edge cards included
    const target = toHand ? null : groupTargetPile();
    // bottom first: each release brings its token above the others, so the
    // stack keeps its order
    for (const counter of [...hand]) {
      requestRelease(counter, toHand, target !== null && counter.isCard ? target : null, toPlayer);
    }
    return;
  }
  // the answer to the acquire, to the pick, to the take or to the draw is
  // still on its way
  if (
    pending?.action === "acquire" ||
    pending?.action === "pick" ||
    pending?.action === "take" ||
    pending?.action === "draw"
  ) {
    releaseOnArrival = true;
  }
}

function onMouseDown(event: MouseEvent): void {
  const sx = event.offsetX;
  const sy = event.offsetY;

  // the right button only moves the camera, whatever lies under the pointer,
  // and even with counters in hand: they follow the pointer again afterwards
  if (event.button === MOUSE_RIGHT) {
    // the view of the followed player moves the camera
    if (followedPlayer !== null) return;
    panning = true;
    lastMouseX = sx;
    lastMouseY = sy;
    return;
  }
  // the left button acts on the game; the others do nothing, and the middle
  // one must not start the browser's autoscroll either
  if (event.button !== MOUSE_LEFT) {
    event.preventDefault();
    return;
  }
  // a drag that leaves the canvas must not select the text of the page
  event.preventDefault();
  const [wx, wy] = screenToWorld(sx, sy);

  // the "flip" and "roll" buttons are drawn on screen and aimed in screen
  // coordinates: they do not depend on the flip of a board.
  for (const plate of flipPlates) {
    if (placeFlipButton(plate).contains(sx, sy)) {
      plate.button.callback();
      return;
    }
  }

  // un plateau retourné inverse sa carte : le pointeur est ramené dans l'espace
  // logique avant de tester pions, dés et fantômes
  const [lx, ly] = flipPoint(wx, wy);
  lastMouseWorldX = lx;
  lastMouseWorldY = ly;

  // une requête est déjà en attente de réponse du serveur
  if (pending !== null) return;

  // clic sur le fantôme d'un pion "transparent" : la caméra se recentre sur le
  // pion, joueurs comme spectateurs. Le fantôme étant dessiné sous les pions,
  // un pion réel sous le pointeur garde la priorité.
  if (hitCounter(lx, ly) === null) {
    const ghost = hitOriginGhost(lx, ly);
    if (ghost !== null) {
      centerCameraOn(ghost);
      return;
    }
  }

  // un spectateur regarde : il ne prend aucun pion en main. Le serveur refuse
  // l'acquire de son côté, on n'envoie donc même pas la demande. Il peut en
  // revanche déplacer la caméra comme un joueur, pour suivre la partie.
  if (!isWatcher) {
    // click on the "roll" button of a dice pool: drawn on screen like the
    // "flip" button, it is aimed in screen coordinates
    for (const plate of rollPlates) {
      if (placeRollButton(plate).contains(sx, sy)) {
        plate.button.callback();
        return;
      }
    }

    // clic sur un dé : il se lance sur place, sans le prendre en main
    const clickedDice = hitDiceAt(lx, ly);
    if (clickedDice !== null) {
      requestRoll(clickedDice);
      return;
    }

    // clic sur une zone + ou - d'un compteur : demande de changer sa valeur.
    // Ces zones priment sur le pion, comme les zones de rotation priment sur
    // la prise en main du pion qu'elles recouvrent.
    if (hand.length === 0) {
      const box = hitCounterBox(counterBoxes, lx, ly);
      const zone = box === null ? null : counterActionZoneAt(box, lx, ly);
      if (box !== null && zone !== null) {
        // le signe grise quand la valeur a atteint sa borne : on n'envoie rien,
        // le serveur refuserait de toute facon. Le clic reste absorbe par le
        // compteur, il ne doit pas tomber sur le plateau en dessous.
        if (isActionEnabled(box, zone)) {
          requestCounterValue(box, zone);
        }
        return;
      }
    }

    // click on a box of an mw_character: it is marked. Like the + and - of a
    // counter, the boxes come before a token lying over them.
    if (hand.length === 0) {
      const character = hitMwCharacter(mwCharacters, lx, ly);
      const box = character === null ? null : boxAt(character, lx, ly);
      if (character !== null && box !== null) {
        requestMark(character, box.column, box.index);
        return;
      }
    }

    // click on a button of a deck: shuffle, refill or deal. Like the + and -
    // of a counter, the buttons come before a token lying over them.
    if (hand.length === 0) {
      const deckButton = deckButtonAt(decks, lx, ly, dealPlayers());
      if (deckButton !== null) {
        requestDeckAction(deckButton);
        return;
      }
    }

    // A token is still in hand without the button being down (session
    // resumed, answer that came late): the press takes the hand over, and the
    // button coming up puts it down like any other.
    if (hand.length > 0) {
      dragging = true;
      releaseOnArrival = false;
      handWorldX = lx;
      handWorldY = ly;
      return;
    }

    // button down on a token: it is asked for, and follows the pointer until
    // the button comes up
    const hit = hitCounter(lx, ly);
    if (hit !== null) {
      // avant de le prendre en main, on vérifie si le clic visait une zone de
      // rotation. Ces zones n'existent pas pendant qu'on tient un pion : le
      // repère est déjà occupé par ce qu'on déplace.
      if (hand.length === 0) {
        const zone = hit.rotationZoneAt(lx, ly);
        if (zone !== null) {
          requestRotate(hit, zone);
          return;
        }
      }
      dragging = true;
      releaseOnArrival = false;
      grabbedName = hit.name;
      grabWorldX = lx;
      grabWorldY = ly;
      // only a press that really asked for the token can grow into a stack
      if (requestAcquire(hit)) armLongPress(sx, sy);
      return;
    }

    // click on a bag: one of its tokens comes out at random. A token lying
    // on the bag is drawn above it and was taken first.
    const clickedBag = hitBag(bags, lx, ly);
    if (clickedBag !== null) {
      // the token drawn comes out under the pointer, already being dragged
      dragging = true;
      releaseOnArrival = false;
      grabbedName = null;
      requestPick(clickedBag, lx, ly);
      return;
    }

    // button down on an mw_character with cards under it: the last one comes
    // out once the pointer moves away with the button still down
    const pressedCharacter = hitMwCharacter(mwCharacters, lx, ly);
    if (pressedCharacter !== null && pressedCharacter.cards.length > 0) {
      armedCharacter = pressedCharacter;
      armedCharacterScreenX = sx;
      armedCharacterScreenY = sy;
      return;
    }

    // button down on a 1 / 5 / 10 button of a pile: the cards come out once
    // the pointer moves away with the button still down
    const drawButton = hand.length === 0 ? drawButtonAt(decks, lx, ly) : null;
    if (drawButton !== null) {
      if (drawButton.enabled) {
        armedDraw = drawButton;
        armedDrawScreenX = sx;
        armedDrawScreenY = sy;
      } else {
        showInfoMessage(`Il reste moins de ${drawButton.count} cartes`);
      }
      return;
    }

    // click on a pile of a deck: its top card comes out. A card lying on the
    // pile is drawn above it and was taken first.
    const clickedPile = pileAt(decks, lx, ly);
    if (clickedPile !== null) {
      // the card drawn comes out under the pointer, already being dragged
      dragging = true;
      releaseOnArrival = false;
      grabbedName = null;
      requestDraw(clickedPile.deck, clickedPile.pile, lx, ly);
      return;
    }
  }
}

function onMouseMove(event: MouseEvent): void {
  const sx = event.offsetX;
  const sy = event.offsetY;
  pointerOnCanvas = true;
  pointerScreenX = sx;
  pointerScreenY = sy;

  // Le défilement de la caméra a ses propres règles de déclenchement, alors que
  // ce gestionnaire s'interrompt dès qu'un pion est en main. Il est donc appelé
  // avant toute sortie de fonction, et jamais à l'intérieur de la boucle de
  // dessin, qui ignore le temps écoulé depuis le dernier mouvement.
  trackPointerForEdgeScroll(sx, sy);

  const [wx, wy] = screenToWorld(sx, sy);

  // même conversion que dans onMouseDown : le survol et le déplacement d'un
  // pion se calculent dans l'espace logique, pas à l'écran
  const [lx, ly] = flipPoint(wx, wy);
  lastMouseWorldX = lx;
  lastMouseWorldY = ly;

  // le pion survolé alimente l'affichage des zones de rotation. Il change dès
  // que la main se vide ou se remplit : les zones suivent cette condition.
  const canHover = !isWatcher && hand.length === 0;
  hoveredCounter = canHover ? hitCounter(lx, ly) : null;
  hoveredCounterBox = canHover ? hitCounterBox(counterBoxes, lx, ly) : null;

  // the right button was released where no mouseup reached the page
  if (panning && (event.buttons & MOUSE_RIGHT_MASK) === 0) {
    panning = false;
  }

  if (panning) {
    cameraX -= (sx - lastMouseX) / zoom;
    cameraY -= (sy - lastMouseY) / zoom;
    lastMouseX = sx;
    lastMouseY = sy;
    return;
  }

  // the pointer comes from the private hand with the button down: the token
  // it went down on is played here
  if (armedHandItem !== null) {
    const played = armedHandItem;
    armedHandItem = null;
    if ((event.buttons & MOUSE_LEFT_MASK) !== 0 && pending === null && hand.length === 0) {
      requestTake(played, lx, ly);
    }
  }

  // the pointer leaves a 1 / 5 / 10 button of a pile with the button down:
  // that many cards are drawn, and follow the pointer
  if (armedDraw !== null) {
    if ((event.buttons & MOUSE_LEFT_MASK) === 0) {
      armedDraw = null;
    } else if (Math.hypot(sx - armedDrawScreenX, sy - armedDrawScreenY) > LONG_PRESS_SLACK) {
      const button = armedDraw;
      armedDraw = null;
      if (pending === null && hand.length === 0) {
        dragging = true;
        releaseOnArrival = false;
        grabbedName = null;
        requestDraw(button.deck, button.pile, lx, ly, button.count);
      }
    }
  }

  if (armedCharacter !== null) {
    if ((event.buttons & MOUSE_LEFT_MASK) === 0) {
      armedCharacter = null;
    } else if (Math.hypot(sx - armedCharacterScreenX, sy - armedCharacterScreenY) > LONG_PRESS_SLACK) {
      const character = armedCharacter;
      armedCharacter = null;
      if (pending === null && hand.length === 0) {
        dragging = true;
        releaseOnArrival = false;
        grabbedName = null;
        requestCharacterPick(character, lx, ly);
      }
    }
  }

  // the pointer left the press point: this is a drag, not a long press
  if (
    longPressTimer !== null &&
    Math.hypot(sx - pressScreenX, sy - pressScreenY) > LONG_PRESS_SLACK
  ) {
    cancelLongPress();
  }

  // the left button was released where no mouseup reached the page
  if (dragging && (event.buttons & MOUSE_LEFT_MASK) === 0) {
    dropHand();
  }

  // the hand only follows the pointer while the button holds it
  if (hand.length > 0 && dragging) {
    const dx = lx - handWorldX;
    const dy = ly - handWorldY;
    for (const counter of hand) {
      counter.x += dx;
      counter.y += dy;
    }
    handWorldX = lx;
    handWorldY = ly;
    movesDirty = true;
    counterInfoText = handInfoText();
  }

  lastMouseX = sx;
  lastMouseY = sy;
}

// Listened on the canvas and on the window: the same mouseup may come twice,
// dropHand only acts on the first.
function onMouseUp(event: MouseEvent): void {
  // only releasing the right button ends the camera move
  if (event.button === MOUSE_RIGHT) panning = false;
  if (event.button === MOUSE_LEFT) {
    const receiver = privateHandEnabled ? receiverAt(event.clientX, event.clientY) : null;
    highlightReceiver(null);
    // a token of the strip or of the area released on the name of a player
    if (armedHandItem !== null && receiver !== null) {
      requestGive(armedHandItem, receiver);
      armedHandItem = null;
    }
    if (armedHandItem !== null) {
      const shown = myShownIds().has(armedHandItem.name);
      // a card of the strip released on the area of the reader is shown there
      if (!shown && overMyShowZone(event.clientX, event.clientY)) {
        sendShow({ action: "show_add", component_id: armedHandItem.name });
      }
      // a card of that area released on the strip is hidden there again
      if (shown && overPrivateHand(event.clientX, event.clientY)) {
        sendShow({ action: "show_remove", component_id: armedHandItem.name });
      }
    }
    armedHandItem = null;
    armedDraw = null;
    armedCharacter = null;
    // a token carried on the table and released on the name of a player
    // joins the hand of that player
    if (receiver !== null) dropHand(true, receiver);
    else dropHand(overPrivateHand(event.clientX, event.clientY));
    privateHand?.classList.remove("drop-target");
  }
}

// Listened on the window: the canvas hears nothing once the pointer is over
// the private hand. The strip lights up while a release would keep the token.
function onWindowMouseMove(event: MouseEvent): void {
  if (!privateHand) return;
  const carried =
    (dragging && hand.length > 0) ||
    // a card grabbed in the area of the reader, button still down
    (armedHandItem !== null && (event.buttons & MOUSE_LEFT_MASK) !== 0 &&
      myShownIds().has(armedHandItem.name));
  const target = carried && overPrivateHand(event.clientX, event.clientY);
  // a token carried from the table, the strip or the area lights the name
  // of the player it would be given to
  const carrying =
    (dragging && hand.length > 0) ||
    (armedHandItem !== null && (event.buttons & MOUSE_LEFT_MASK) !== 0);
  highlightReceiver(
    carrying && privateHandEnabled ? receiverAt(event.clientX, event.clientY) : null,
  );
  privateHand.classList.toggle("drop-target", target);
}

// -------------------------------------------------
// Stack preview
// -------------------------------------------------

// Pointer position on the canvas, in screen pixels. The preview is recomputed
// every frame from it, so it follows panning, zooming and remote moves.
let pointerOnCanvas = false;
let pointerScreenX = 0;
let pointerScreenY = 0;

// every counter under (wx, wy), bottom of the stack first
function countersAt(wx: number, wy: number): Counter[] {
  return counters.filter((counter) => counter.contains(wx, wy));
}

// screen-space bounding box of a counter at the current zoom, rotation included
function previewCellSize(counter: Counter): [number, number] {
  const angle = (counter.orientation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  return [
    (counter.width * cos + counter.height * sin) * zoom,
    (counter.width * sin + counter.height * cos) * zoom,
  ];
}

// A counter lying on its back keeps its front hidden from the table, but not
// from the players of its nationality: they may look at it, on their own
// screen only. A watcher only sees the faces shown on the table.
function revealsFront(counter: Counter): boolean {
  return (
    !isWatcher &&
    counter.side === "back" &&
    counter.nationality !== null &&
    counter.nationality === myNationality &&
    counter.frontImage.complete
  );
}

// A counter with block_sight hides what lies under it from the watchers and
// from the players of another nationality.
function blocksSightOf(counter: Counter): boolean {
  return counter.blockSight && (isWatcher || counter.nationality !== myNationality);
}

/**
 * For each counter of a stack (bottom first), the counter blocking the sight
 * of this player on it, or null when it is seen. Every counter under the
 * highest counter that blocks the sight is masked by that one, except those
 * of this player's own nationality: a player always knows their own counters.
 */
function sightBlockers(stack: Counter[]): (Counter | null)[] {
  const masks: (Counter | null)[] = stack.map(() => null);
  let blocker: Counter | null = null;
  for (let index = stack.length - 1; index >= 0; index--) {
    const counter = stack[index];
    const own = !isWatcher && counter.nationality !== null && counter.nationality === myNationality;
    if (blocker !== null && !own) masks[index] = blocker;
    if (blocker === null && blocksSightOf(counter)) blocker = counter;
  }
  return masks;
}

/**
 * Draws, in screen space, a popup about the counters under the pointer.
 *
 * When at least two overlap there, it holds every one of them, in stacking
 * order (left to right, then top to bottom), with their face and orientation.
 * Under each line of counters, a second line shows the front of those lying
 * on their back that this player is allowed to look at (revealsFront).
 *
 * A single counter gets a popup only when its front may be looked at: the
 * popup then holds that front alone.
 *
 * A counter whose sight is blocked (sightBlockers) is shown with the face of
 * the counter blocking it.
 */
/**
 * Draws, in screen space, a popup with the front of every card lying under
 * the mw_character under the pointer, the one a drag takes first on the left.
 * A token lying on the character keeps the stack preview instead.
 */
function drawCharacterPreview(): void {
  if (!pointerOnCanvas || panning || hand.length > 0) return;
  const [wx, wy] = screenToWorld(pointerScreenX, pointerScreenY);
  const [lx, ly] = flipPoint(wx, wy);
  if (countersAt(lx, ly).length > 0) return;
  const character = hitMwCharacter(mwCharacters, lx, ly);
  if (character === null || character.cards.length === 0) return;

  const cards = [...character.cards].reverse();
  const cellHeight = CHARACTER_PREVIEW_CARD_HEIGHT;
  const widths = cards.map((card) => (card.width / card.height) * cellHeight);
  const cellWidth = Math.max(...widths);

  // as many columns as fit beside the pointer, wrapping to new rows otherwise
  const roomRight = canvas.width - pointerScreenX - STACK_PREVIEW_OFFSET;
  const roomLeft = pointerScreenX - STACK_PREVIEW_OFFSET;
  const room = Math.max(roomRight, roomLeft) - 2 * STACK_PREVIEW_PADDING;
  const maxColumns = Math.max(1, Math.floor((room + STACK_PREVIEW_GAP) / (cellWidth + STACK_PREVIEW_GAP)));
  const columns = Math.min(cards.length, maxColumns);
  const rows = Math.ceil(cards.length / columns);
  const popupWidth = columns * cellWidth + (columns - 1) * STACK_PREVIEW_GAP + 2 * STACK_PREVIEW_PADDING;
  const popupHeight = rows * cellHeight + (rows - 1) * STACK_PREVIEW_GAP + 2 * STACK_PREVIEW_PADDING;

  let popupX = pointerScreenX + STACK_PREVIEW_OFFSET;
  if (popupX + popupWidth > canvas.width && roomLeft > roomRight) {
    popupX = pointerScreenX - STACK_PREVIEW_OFFSET - popupWidth;
  }
  let popupY = pointerScreenY - popupHeight / 2;
  popupY = Math.max(0, Math.min(canvas.height - popupHeight, popupY));

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "rgba(30, 30, 30, 0.92)";
  ctx.fillRect(popupX, popupY, popupWidth, popupHeight);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#ffd700";
  ctx.strokeRect(popupX, popupY, popupWidth, popupHeight);
  cards.forEach((card, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const cellX = popupX + STACK_PREVIEW_PADDING + column * (cellWidth + STACK_PREVIEW_GAP);
    const cellY = popupY + STACK_PREVIEW_PADDING + row * (cellHeight + STACK_PREVIEW_GAP);
    const width = widths[index];
    if (card.front.complete && card.front.naturalWidth > 0) {
      ctx.drawImage(card.front, cellX + (cellWidth - width) / 2, cellY, width, cellHeight);
    }
  });
  ctx.restore();
}

function drawStackPreview(): void {
  // while dragging, the held counters are the ones under the pointer
  if (!pointerOnCanvas || panning || hand.length > 0) return;

  const [wx, wy] = screenToWorld(pointerScreenX, pointerScreenY);
  const [lx, ly] = flipPoint(wx, wy);
  const under = countersAt(lx, ly);
  const stack = under.filter((counter) => counter.image.complete);
  const masks = sightBlockers(stack);
  const showCounters = stack.length >= 2;
  if (!showCounters && !stack.some(revealsFront)) return;

  // uniform cells, sized on the largest counter of the stack
  let cellWidth = 0;
  let cellHeight = 0;
  for (const counter of stack) {
    const [w, h] = previewCellSize(counter);
    cellWidth = Math.max(cellWidth, w);
    cellHeight = Math.max(cellHeight, h);
  }

  // as many columns as fit beside the pointer, wrapping to new rows otherwise
  const roomRight = canvas.width - pointerScreenX - STACK_PREVIEW_OFFSET;
  const roomLeft = pointerScreenX - STACK_PREVIEW_OFFSET;
  const room = Math.max(roomRight, roomLeft) - 2 * STACK_PREVIEW_PADDING;
  const maxColumns = Math.max(1, Math.floor((room + STACK_PREVIEW_GAP) / (cellWidth + STACK_PREVIEW_GAP)));
  const columns = Math.min(stack.length, maxColumns);

  // the lines of the popup, top to bottom: each line of counters, followed by
  // the line of their fronts when one of them may be looked at
  const lines: { counters: Counter[]; fronts: boolean }[] = [];
  for (let first = 0; first < stack.length; first += columns) {
    const row = stack.slice(first, first + columns);
    if (showCounters) lines.push({ counters: row, fronts: false });
    if (row.some(revealsFront)) lines.push({ counters: row, fronts: true });
  }

  const popupWidth = columns * cellWidth + (columns - 1) * STACK_PREVIEW_GAP + 2 * STACK_PREVIEW_PADDING;
  const popupHeight =
    lines.length * cellHeight + (lines.length - 1) * STACK_PREVIEW_GAP + 2 * STACK_PREVIEW_PADDING;

  // to the right of the pointer, or to its left when it would not fit
  let popupX = pointerScreenX + STACK_PREVIEW_OFFSET;
  if (popupX + popupWidth > canvas.width && roomLeft > roomRight) {
    popupX = pointerScreenX - STACK_PREVIEW_OFFSET - popupWidth;
  }
  // vertically centered on the pointer, kept inside the canvas
  let popupY = pointerScreenY - popupHeight / 2;
  popupY = Math.max(0, Math.min(canvas.height - popupHeight, popupY));

  ctx.save();
  ctx.fillStyle = "rgba(30, 30, 30, 0.92)";
  ctx.fillRect(popupX, popupY, popupWidth, popupHeight);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#ffd700";
  ctx.strokeRect(popupX, popupY, popupWidth, popupHeight);

  // clip so a counter shadow or border never spills out of the popup
  ctx.beginPath();
  ctx.rect(popupX, popupY, popupWidth, popupHeight);
  ctx.clip();

  lines.forEach((line, lineIndex) => {
    const cellY = popupY + STACK_PREVIEW_PADDING + lineIndex * (cellHeight + STACK_PREVIEW_GAP);
    if (line.fronts && showCounters) {
      // a lighter band tells the line of hidden fronts from the stack itself
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "rgba(255, 215, 0, 0.18)";
      ctx.fillRect(
        popupX,
        cellY - STACK_PREVIEW_GAP / 2,
        popupWidth,
        cellHeight + STACK_PREVIEW_GAP,
      );
    }
    line.counters.forEach((seen, column) => {
      // a counter out of sight is drawn as the counter blocking it
      const counter = masks[stack.indexOf(seen)] ?? seen;
      // a front line keeps each front under its counter: the other cells stay empty
      if (line.fronts && !revealsFront(counter)) return;
      const cellX = popupX + STACK_PREVIEW_PADDING + column * (cellWidth + STACK_PREVIEW_GAP);
      // the counter center lands on the cell center: rotation is around it
      const centerX = cellX + cellWidth / 2;
      const centerY = cellY + cellHeight / 2;
      ctx.setTransform(
        zoom,
        0,
        0,
        zoom,
        centerX - (counter.x + counter.width / 2) * zoom,
        centerY - (counter.y + counter.height / 2) * zoom,
      );
      if (line.fronts) {
        counter.drawFront(ctx);
      } else {
        counter.draw(ctx);
      }
    });
  });

  ctx.restore();

  // the counters still loading are counted too: they are on the table
  if (showCounters) drawStackCount(under.length, popupX + popupWidth, popupY);
}

/**
 * Draws, in screen space, the badge holding the number of counters of a
 * stack, its right end STACK_COUNT_INSET px left of (right, top) and centered
 * on that line, so that it sits across the top border of the popup.
 */
function drawStackCount(count: number, right: number, top: number): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = STACK_COUNT_FONT;
  const text = String(count);
  const width = Math.max(
    STACK_COUNT_HEIGHT,
    ctx.measureText(text).width + 2 * STACK_COUNT_PADDING,
  );
  const x = right - STACK_COUNT_INSET - width;
  const y = top - STACK_COUNT_HEIGHT / 2;

  ctx.beginPath();
  ctx.roundRect(x, y, width, STACK_COUNT_HEIGHT, STACK_COUNT_HEIGHT / 2);
  // opaque, so the popup border does not cross the number
  ctx.fillStyle = "#1e1e1e";
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#ffd700";
  ctx.stroke();

  ctx.fillStyle = "#ffd700";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + width / 2, top);
  ctx.restore();
}

// Un pointeur qui quitte le canvas ne peut plus s'en éloigner : le seul signal
// qu'il enverra pour arrêter est son retour. Sans cette remise à zéro, la carte
// continuerait de défiler indéfiniment, et le joueur n'aurait plus le moyen de
// l'arrêter autrement qu'en revenant au bord, ce qui le relance. Le défilement
// repart au retour, avec son délai d'entrée.
function onMouseLeave(): void {
  edgeInside = false;
  pointerOnCanvas = false;
  panning = false;
}

// ---------------------------------------------
// Gestes de la caméra : suivi du pointeur
// ---------------------------------------------

// Le pointeur est-il dans une bande de défilement ? C'est le seul état qui
// commande l'arrêt : le défilement dure tant que le pointeur y reste, et
// s'interrompt dès qu'il en sort.
let edgeInside = false;

// Instant où le défilement devient permis. Nul tant que le pointeur n'a pas
// touché de bord.
let edgeArmedAt = 0;

// Horloge de la boucle de dessin : le défilement se déplace d'un pas de temps
// réel, pas d'un rafraîchissement, pour que sa vitesse ne dépende pas du nombre
// d'images par seconde.
let lastFrameAt = 0;

// Le pointeur est-il dans une bande, et assez longtemps pour que ce geste soit
// une intention plutôt qu'un frôlement ?
function edgeScrolling(): boolean {
  if (!edgeInside) return false;
  return Date.now() >= edgeArmedAt;
}

function trackPointerForEdgeScroll(sx: number, sy: number): void {
  edgeX = sx;
  edgeY = sy;

  // Un pointeur pressé contre un bord ne quitte jamais la bande : la minuterie
  // ne doit donc être remise qu'à son entrée, sinon le défilement ne démarrerait
  // jamais. Le défilement s'arrête quand le pointeur s'écarte, rien d'autre.
  const inside =
    Math.abs(edgeSignedOnAxis(sx, canvas.width)) > 0 ||
    Math.abs(edgeSignedOnAxis(sy, canvas.height)) > 0;
  if (inside && !edgeInside) {
    edgeArmedAt = Date.now() + EDGE_SCROLL_DELAY_MS;
  }
  edgeInside = inside;
}

/**
 * Le double-clic retourne le pion sous le pointeur. Le simple-clic, lui, le
 * prend en main : les deux gestes se cumulent, comme dans le Vietnam d'avant,
 * où un double-clic attrapait le compteur et le retournait en même temps.
 */
function onDoubleClick(event: MouseEvent): void {
  // un spectateur regarde : il ne retourne rien. Le serveur refuse de son côté,
  // le double-clic n'a donc rien à lui demander.
  if (isWatcher) return;

  const [wx, wy] = screenToWorld(event.offsetX, event.offsetY);
  const [lx, ly] = flipPoint(wx, wy);
  // un pion en main a quitté sa case : c'est lui que le pointeur vise, pas ce
  // qui se trouve dessous
  const held = hand.find((counter) => counter.contains(lx, ly));
  const hit = held ?? hitCounter(lx, ly);
  if (hit === null) {
    // no token there: an mw_character under the pointer turns over, unless
    // the double click was on one of its boxes
    const character = hitMwCharacter(mwCharacters, lx, ly);
    if (character !== null && boxAt(character, lx, ly) === null) requestCharacterFlip(character);
    return;
  }

  requestFlip(hit);
}

function onMouseWheel(event: WheelEvent): void {
  event.preventDefault();

  // while following a view, the zoom keeps its center in the middle
  const mx = followedPlayer === null ? event.offsetX : canvas.width / 2;
  const my = followedPlayer === null ? event.offsetY : canvas.height / 2;
  const [wx, wy] = screenToWorld(mx, my);

  zoom *= event.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
  zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));

  cameraX = wx - mx / zoom;
  cameraY = wy - my / zoom;
}

// -------------------------------------------------
// Dessin
// -------------------------------------------------

function draw(): void {
  initializeCamera();
  // le setup attend que tout soit charge, comme la camera attend les plateaux
  maybeRequestSetup();

  ctx.fillStyle = "gray";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.setTransform(
    zoom,
    0,
    0,
    zoom,
    -cameraX * zoom,
    -cameraY * zoom,
  );

  for (const board of boards) {
    drawBoard(board, ctx);
  }

  if (showGrid) drawGridOverlay(ctx);
  // under the tokens, so the held one stays visible over its target hex
  drawTargetHexes(ctx);

  // les compteurs par-dessus le plateau : un cadre et un nombre, que les deux
  // zones + et - viennent recouvrir
  for (const box of counterBoxes) {
    drawAtDisplay(ctx, box.x, box.y, box.width, box.height, () => {
      drawCounterBox(ctx, box);
    });
  }

  // the mw_character cards lie on the board, under the tokens
  for (const character of mwCharacters) {
    drawAtDisplay(ctx, character.x, character.y, character.width, character.height, () => {
      drawMwCharacter(ctx, character);
    });
  }

  // bags lie on the board, under the tokens. A bag a held token hovers over
  // is outlined: releasing the token there drops it in.
  for (const bag of bags) {
    const targeted = hand.some((counter) => bagUnder(bags, counter) === bag);
    drawAtDisplay(ctx, bag.x, bag.y, bag.width, bag.height, () => {
      drawBag(ctx, bag, targeted);
    });
  }

  // decks lie on the board like bags. A pile a held card hovers over is
  // outlined; only a player has buttons to click.
  // A group of cards outlines the one pile it joins together.
  const groupTarget = groupTargetPile();
  const targetedPiles = groupTarget !== null ? [groupTarget.pile] : hand.map((counter) => pileUnder(decks, counter));
  drawDecks(ctx, targetedPiles, !isWatcher);

  // les fantômes de case d'origine passent sous les pions, pour que le pion
  // réel posé dessus reste lisible
  for (const counter of counters) {
    if (!counter.showsOriginGhost) continue;
    const originX = counter.originX;
    const originY = counter.originY;
    if (originX === null || originY === null) continue;
    drawAtDisplay(ctx, originX, originY, counter.width, counter.height, () => {
      counter.drawOriginGhost(ctx);
    });
  }

  // les pions sont dessinés dans l'ordre de la liste : un pion plus loin dans
  // la liste recouvre ceux d'avant. Un relâchement remet le pion en fin de
  // liste, si bien qu'il reste au-dessus de la pile qu'il vient de rejoindre.
  for (const counter of counters) {
    if (hand.includes(counter)) continue;
    if (counter.image.complete) {
      drawCounterAtDisplay(counter);
    }
  }

  // la main se dessine après le plateau : un pion sélectionné est toujours
  // visible, au-dessus des pions non sélectionnés
  for (const counter of hand) {
    if (counter.image.complete) {
      drawCounterAtDisplay(counter);
    }
  }

  // les zones de rotation par-dessus le pion survolé. Elles ne s'affichent que
  // pour un joueur, pion orientable, main vide : un pion qu'on s'apprête à
  // saisir n'a pas besoin de ce repère, et un spectateur n'agit pas sur le jeu
  // nor does a token this player may not touch
  if (!isWatcher && hand.length === 0 && hoveredCounter?.orientable && canAcquire(hoveredCounter)) {
    const counter = hoveredCounter;
    drawAtDisplay(ctx, counter.x, counter.y, counter.width, counter.height, () => {
      counter.drawRotationZones(ctx);
    });
  }

  // les zones + et - par-dessus le compteur survolé. Comme les zones de
  // rotation d'un pion, elles ne s'affichent que pour un joueur, main vide : un
  // spectateur n'agit pas sur le jeu, et la main occupe déjà l'écran
  if (!isWatcher && hand.length === 0 && hoveredCounterBox !== null) {
    const box = hoveredCounterBox;
    drawAtDisplay(ctx, box.x, box.y, box.width, box.height, () => {
      drawCounterActionZones(ctx, box);
    });
  }

  for (const dice of dices) {
    const image = dice.face();
    if (!image?.complete) continue;
    drawAtDisplay(ctx, dice.x, dice.y, dice.width, dice.height, () => {
      ctx.drawImage(image, dice.x, dice.y, dice.width, dice.height);
      // le dé assombrit pendant son délai : on voit qu'il n'est pas encore
      // jouable plutôt que de constater qu'un clic a été ignoré
      if (dice.isLocked()) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
        ctx.fillRect(dice.x, dice.y, dice.width, dice.height);
      }
    });
  }

  ctx.restore();

  // les boutons "flip" par-dessus le jeu, pour rester cliquables même quand un
  // pion passe sous eux, mais sous le bandeau d'info : le nom du pion
  // sélectionné doit rester lisible d'un bout à l'autre. A flipped group occupies the same bounding box, so its button
  // stays at the same place on screen.
  for (const plate of flipPlates) {
    placeFlipButton(plate).draw(ctx);
  }

  // the "roll" buttons of the dice pools, for players only: a watcher does not
  // throw. A button darkens with its dice while the pool waits for its delay.
  if (!isWatcher) {
    for (const plate of rollPlates) {
      const button = placeRollButton(plate);
      button.draw(ctx);
      if (isPoolLocked(plate.pool)) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
        ctx.fillRect(button.x, button.y, button.w, button.h);
      }
    }
  }

  // above the game and the flip buttons, below the info bar
  drawStackPreview();
  drawCharacterPreview();

  // barre d'info (écran) : un message pendant INFO_MESSAGE_MS, sinon nom +
  // position du pion quand le jeu affiche les id
  const infoText = performance.now() < infoMessageUntil ? infoMessage : counterInfoText;
  if (infoText) {
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, 28);
    ctx.fillStyle = "white";
    ctx.font = "bold 16px monospace";
    ctx.fillText(infoText, 10, 20);
  }

  // grid calibration: pointer position relative to the board, bottom left
  if (showGrid) {
    ctx.fillStyle = "black";
    ctx.fillRect(0, canvas.height - 28, canvas.width, 28);
    ctx.fillStyle = "white";
    ctx.font = "bold 16px monospace";
    ctx.fillText(gridCalibrationText(), 10, canvas.height - 8);
  }
}

// -------------------------------------------------
// Messages du serveur Tourtoirac
// -------------------------------------------------

function handleServerMessage(raw: unknown): void {
  const data = raw as GameServerMessage;
  if (!data || typeof data !== "object") return;

  // the WebRTC messages relayed between players are many and long: not logged
  if (data.event !== "voice_signal" && data.event !== "view") console.log("[WS] Message reçu :", JSON.stringify(data));

  try {
    if (data.event === "acquire" || data.event === "release") {
      const answer = data as unknown as HandEvent;
      // an acquire asked by a long press: several are in flight at once
      const fromStack =
        answer.event === "acquire" && stackRequests.delete(answer.component_id);
      const isOwnRequest =
        fromStack ||
        (pending?.action === answer.event && pending.componentId === answer.component_id);

      if (isOwnRequest && !fromStack) {
        clearPending();
      }

      if (!answer.success) {
        console.warn("[WS]", answer.event, "refusé pour", answer.component_id);
        return;
      }

      applyHandEvent(answer, isOwnRequest, fromStack);
    } else if (data.event === "pick") {
      applyPick(data as unknown as PickEvent);
    } else if (data.event === "take") {
      applyPick(data as unknown as TakeEvent);
    } else if (data.event === "draw") {
      applyPick(data as unknown as DrawEvent);
    } else if (data.event === "shuffle" || data.event === "refill") {
      applyDeckEvent(data as unknown as DeckEvent);
    } else if (data.event === "deal") {
      applyDeal(data as unknown as DealEvent);
    } else if (data.event === "voice_joined") {
      voice.onJoined(data as unknown as VoiceJoinedEvent);
    } else if (data.event === "voice_members") {
      voice.setMembers((data as unknown as VoiceMembersEvent).members);
    } else if (data.event === "voice_signal") {
      const signal = data as unknown as VoiceSignalEvent;
      void voice.onSignal(signal.from, signal.data);
    } else if (data.event === "chat") {
      chat?.receive((data as unknown as ChatEvent).message);
    } else if (data.event === "give") {
      applyGive(data as unknown as GiveEvent);
    } else if (data.event === "show") {
      applyShow(data as unknown as ShowEvent);
    } else if (data.event === "followed") {
      applyFollowed((data as unknown as FollowedEvent).followers);
    } else if (data.event === "view") {
      applyView(data as unknown as ViewEvent);
    } else if (data.event === "move") {
      applyRemoteMove(data as unknown as MoveEvent);
    } else if (data.event === "roll") {
      applyRoll(data as unknown as RollEvent);
    } else if (data.event === "roll_pool") {
      applyRollPool(data as unknown as RollPoolEvent);
    } else if (data.event === "rotate") {
      applyRotate(data as unknown as RotateEvent);
    } else if (data.event === "flip") {
      applyFlip(data as unknown as FlipEvent);
    } else if (data.event === "counter_value") {
      applyCounterValue(data as unknown as CounterValueEvent);
    } else if (data.event === "mark") {
      applyMark(data as unknown as MarkEvent);
    } else if (data.event === "fix_positions") {
      applyFixPositions(data as unknown as FixPositionsEvent);
    } else if (data.event === "setup") {
      applySetup(data as unknown as SetupEvent);
    } else if (data.event === "session_status") {
      applySessionStatus(data as unknown as SessionStatusEvent);
    } else if (data.event === "session_closed") {
      applySessionClosed();
      // l'owner qui vient de cliquer part sur le lobby, les autres restent
      // sur la partie close
      if (pendingClose) {
        pendingClose = false;
        window.location.href = leaveUrl;
      }
    } else if (data.event === "error") {
      reportServerError(data as unknown as ServerErrorEvent);
    } else if (data.event === "session_created" || data.event === "session_joined") {
      handleSessionEvent(data);
    }
  } catch (e) {
    console.error("Erreur traitement message:", e);
  }
}

// Une partie close n'existe plus côté back-end : seuls ces refusent
// Justifient d'une fenêtre, les autres erreurs restent dans la console comme
// le fait déjà le reste de la page.
const CLOSE_ERRORS = [
  "not_session_owner",
  "session_closed",
  "session_state_not_stored",
  "session_not_archived",
];

// Le serveur ne connait plus la session : Tourtoirac la garde en memoire, un
// redemarrage l'a perdue. Le plateau affiche n'est qu'un instantane local,
// aucun pion n'y est prenable ; on vide la session morte et on revient au lobby
// plutot que de laisser un plateau qui ne repond plus.
const DEAD_SESSION_ERRORS = ["session_not_found", "no_session"];

let leavingDeadSession = false;

// refus d'un acquire : la partie n'a pas commencé ou un joueur manque. La
// requête en vol n'aura pas de réponse, la main doit se libérer tout de suite.
const ACQUIRE_ERRORS = ["session_not_started", "players_missing"];

// refusal of a pick, of an acquire aimed at a bag or at a token of another
// nationality: nothing to tell the player, but the pending request will get
// no other answer
// the same goes for a draw and for a card inside a deck
const BAG_ERRORS = [
  "bag_empty",
  "component_not_a_bag",
  "component_in_bag",
  "wrong_nationality",
  "pile_empty",
  "unknown_pile",
  "component_not_a_deck",
  "component_in_deck",
];

// refus du démarrage : le bouton redevient cliquable
const START_ERRORS = [
  "not_session_owner",
  "session_already_started",
  "session_start_not_stored",
  "watcher_not_allowed",
];

function reportServerError(data: ServerErrorEvent): void {
  const code = data.error?.code;
  console.warn("[WS] Erreur du serveur :", code, data.error?.message);

  if (code && ACQUIRE_ERRORS.includes(code)) {
    clearPending();
    // the local state may lag behind the server: the refusal is shown anyway
    if (code === "session_not_started") warnGameNotStarted();
    if (code === "players_missing") warnPlayersMissing();
    return;
  }

  if (code && BAG_ERRORS.includes(code)) {
    clearPending();
    return;
  }

  if (code && START_ERRORS.includes(code)) {
    pendingStart = false;
    updateLeaveLinks();
    if (code !== "session_already_started") {
      window.alert(data.error?.message ?? "La partie n'a pas pu être démarrée.");
    }
    return;
  }

  // la partie a commencé sans ce pseudo : il n'y a pas de siège, on ne peut que
  // revenir au lobby, pour la regarder en spectateur par exemple
  if (code === "session_started") {
    if (leavingDeadSession) return;
    leavingDeadSession = true;
    clearSession();
    window.alert(
      "Cette partie a commencé sans toi.\n\n" +
        "Tu reviens au lobby : tu peux la regarder en spectateur.",
    );
    window.location.href = leaveUrl;
    return;
  }

  // the stored game_json of this session cannot be rebuilt by the server:
  // there is no table to show, the player goes back to the lobby
  if (code === "invalid_component") {
    if (leavingDeadSession) return;
    leavingDeadSession = true;
    clearPending();
    clearSession();
    window.alert(invalidComponentMessage(data.error));
    window.location.href = leaveUrl;
    return;
  }

  if (code && DEAD_SESSION_ERRORS.includes(code)) {
    if (leavingDeadSession) return;
    leavingDeadSession = true;
    clearPending();
    clearSession();
    window.alert(
      "Cette partie n'existe plus côté serveur.\n\n" +
        "Tu reviens au lobby : relance une partie pour jouer.",
    );
    window.location.href = leaveUrl;
    return;
  }

  if (!code || !CLOSE_ERRORS.includes(code)) return;

  // la partie n'est pas close : on ne part pas sur le lobby
  pendingClose = false;
  window.alert(data.error?.message ?? "La partie n'a pas pu être close.");
}

// Un composant en mouvement chez un autre joueur :
// on ne touche pas aux composants tenus par ce joueur-ci.
function applyRemoteMove(message: MoveEvent): void {
  const counter = countersById.get(message.component_id);
  if (!counter) return;

  const state = message.coordinates;
  if (!state) return;

  // le rectangle vert est synchronisé même pour celui qui déplace
  if (typeof state.in_place === "boolean") counter.inPlace = state.in_place;

  // la position, elle, suit la souris locale tant que le jeton est en main
  if (hand.includes(counter)) return;
  counter.x = state.x;
  counter.y = state.y;
}

// un joueur a remis le rectangle vert : appliqué par tous les écrans
function applyFixPositions(message: FixPositionsEvent): void {
  for (const component of message.components ?? []) {
    applyComponentState(component);
  }
}

// -------------------------------------------------
// Mise en place du jeu
// -------------------------------------------------

// Le setup attend que tout soit charge. Un pion dont l'image arrive plus tard
// changerait de place sous les yeux du joueur, et un plateau pas encore connu
// ferait cadrer la caméra sur un monde qui n'est plus le bon.
function allComponentsLoaded(): boolean {
  return componentImages().every((image) => image.complete);
}

// Every image the table needs before it can be shown: the single list behind
// allComponentsLoaded and the progress of the loading overlay.
function componentImages(): HTMLImageElement[] {
  const images = boards.map((board) => board.image);
  for (const counter of counters) images.push(counter.image);
  for (const dice of dices) images.push(...dice.faces.values());
  for (const bag of bags) {
    if (bag.image !== null) images.push(bag.image);
    for (const counter of bag.content) images.push(counter.image);
  }
  // an mw_character: its two faces and the icons of its columns
  for (const character of mwCharacters) {
    images.push(character.front);
    if (character.back !== null) images.push(character.back);
    for (const column of Object.values(character.columns)) {
      if (column.icon !== null) images.push(column.icon);
    }
  }
  return images;
}

// -------------------------------------------------
// Loading overlay
// -------------------------------------------------

const loadingOverlay = document.getElementById("loading-overlay");
const loadingText = document.getElementById("loading-text");
const loadingBar = document.getElementById("loading-bar") as HTMLProgressElement | null;
const loadingWarning = document.getElementById("loading-warning");

// has the server described the table since this page opened
let sessionSynced = false;

// another tab of this browser already plays: this page shows why and stops there
let blockedByOtherTab = false;

// the overlay is for the first load only: an image revealed later (flip, pick)
// must not hide the table again
let loadingDone = loadingOverlay === null;

// when the last image arrived, in ms: the setup answer is not awaited forever,
// a table slightly out of place is better than a blocked page
let imagesReadyAt = 0;
const SETUP_WAIT_MS = 8000;

// Called on every frame until the table is ready: session received, every
// image loaded, and the initial setup applied so that no piece jumps into
// place in front of the player. A watcher does not wait for the setup, which
// only a player can request.
function updateLoadingOverlay(): void {
  if (loadingDone || blockedByOtherTab || loadingOverlay === null) return;

  if (!sessionSynced) {
    if (loadingText) loadingText.textContent = "Connexion à la partie…";
    return;
  }

  const images = componentImages();
  const loaded = images.filter((image) => image.complete).length;
  // a broken image is "complete" for the browser: it must not block the table,
  // but it is reported instead of being silently ignored
  const failed = images.filter(
    (image) => image.complete && image.naturalWidth === 0 && image.getAttribute("src"),
  ).length;

  if (loaded === images.length && imagesReadyAt === 0) imagesReadyAt = performance.now();
  const setupSettled =
    pendingSetup.length === 0 || isWatcher || performance.now() - imagesReadyAt > SETUP_WAIT_MS;

  if (loaded === images.length && setupSettled) {
    loadingDone = true;
    loadingOverlay.hidden = true;
    if (failed > 0) console.warn(`[game] ${failed} image(s) introuvable(s)`);
    return;
  }

  if (loadingText) {
    loadingText.textContent =
      loaded < images.length
        ? `Chargement en cours… ${loaded} / ${images.length} images`
        : "Mise en place de la partie…";
  }
  if (loadingBar) {
    loadingBar.max = Math.max(1, images.length);
    loadingBar.value = loaded;
  }
  if (loadingWarning) {
    loadingWarning.textContent = failed > 0 ? `${failed} image(s) introuvable(s)` : "";
  }
}

// Le client ne choisit aucune position : il dit seulement "tout est charge, vous
// pouvez installer la partie". Le serveur applique son setup, qu'il detient seul,
// et le diffuse a tous les ecrans, celui qui a demande compris.
function maybeRequestSetup(): void {
  if (pendingSetup.length === 0 || setupRequested) return;
  // un spectateur regarde la partie, il ne l'installe pas
  if (isWatcher) return;
  if (!allComponentsLoaded()) return;

  setupRequested = true;
  getSocket()?.send({ action: "apply_setup" });
}

// Le setup a ete applique : chaque ecran replace ses composants, quel que soit
// le genre du composant. Un plateau deplace change le monde a cadrer, donc la
// camera doit le revoir.
function applySetup(message: SetupEvent): void {
  let boardMoved = false;

  for (const item of message.components ?? []) {
    // a deck a randomizer took cards from: its piles are read again
    if (decksById.has(item.id)) {
      refreshDeck(item as DeckItem);
      continue;
    }

    const state = item as ComponentState;
    if (typeof state.x !== "number" || typeof state.y !== "number") {
      // a card a randomizer put on a deck or a stack leaves the table: the
      // deck itself is read again from its own entry
      const left = countersById.get(state.id);
      if (left !== undefined && counters.includes(left)) putInBag(left, undefined);
      continue;
    }

    const board = boards.find((candidate) => candidate.name === state.id);
    if (board !== undefined) {
      board.x = state.x;
      board.y = state.y;
      boardMoved = true;
      continue;
    }

    let token = countersById.get(state.id);
    if (token === undefined && "kind" in item && (item.kind === "token" || item.kind === "card")) {
      // a card a randomizer took out of a deck: this screen never had it
      token = createCounter(item as TokenItem);
      countersById.set(token.name, token);
    }
    if (token !== undefined) {
      // a token a randomizer took out of a bag lies on the table from now on
      const placed = token;
      for (const bag of bags) {
        bag.content = bag.content.filter((candidate) => candidate !== placed);
      }
      if (!counters.includes(placed)) counters.push(placed);
      if (typeof state.orientation === "number") token.orientation = state.orientation;
      token.x = state.x;
      token.y = state.y;
      // la case de depart suit le setup : c'est la que revient le pion et la
      // que montre le rectangle vert. Le fantome, lui, reste sur sa case
      // d'origine : on ne touche pas a originX/originY ici.
      token.initialX = typeof state.initial_x === "number" ? state.initial_x : state.x;
      token.initialY = typeof state.initial_y === "number" ? state.initial_y : state.y;
      if (typeof state.in_place === "boolean") token.inPlace = state.in_place;
      // un pion sans dos garde sa face : le serveur ne l'a pas retournee
      token.setFaces(state.front_src, state.back_src);
      if (state.side !== undefined) token.setSide(state.side);
      continue;
    }

    const box = counterBoxesById.get(state.id);
    if (box !== undefined) {
      box.x = state.x;
      box.y = state.y;
      continue;
    }

    const character = mwCharactersById.get(state.id);
    if (character !== undefined) {
      character.x = state.x;
      character.y = state.y;
      if (state.side === "front" || state.side === "back") character.side = state.side;
      continue;
    }

    const dice = dicesById.get(state.id);
    if (dice !== undefined) {
      dice.x = state.x;
      dice.y = state.y;
      continue;
    }

    const bag = bagsById.get(state.id);
    if (bag !== undefined) {
      bag.x = state.x;
      bag.y = state.y;
    }
  }

  if (boardMoved) cameraInitialized = false;

  // le serveur ne renverra plus de setup : la partie est installee
  pendingSetup = [];
}

function handleSessionEvent(data: GameServerMessage): void {
  const session = data.session;
  if (!session?.key) return;
  if (currentSession && session.key !== currentSession.key) return;

  // le serveur fait foi : c'est lui qui dit si l'on joue ou si l'on regarde,
  // et si l'on a le droit de clore la partie
  const event = data as unknown as SessionCreatedEvent;
  if (event.role) isWatcher = event.role === "watcher";
  if (typeof event.owner === "boolean") isOwner = event.owner;
  if (event.nationality !== undefined) {
    myNationality = event.nationality;
    updateGameTitle();
  }
  if (typeof session.started === "boolean") isStarted = session.started;
  if (Array.isArray(session.missing_players)) missingPlayers = session.missing_players;
  // a session joined again after a disconnection: the new connection follows
  // nobody, and the reader gets its camera back
  followedPlayer = null;
  followedView = null;
  updateParticipants(session.participants);
  chat?.setHistory(session.chat);
  updateLeaveLinks();
  // a session joined again after a reconnection: the server knows a new
  // connection, outside the voice channel, and the reader calls back
  voice.setMembers(session.voice);
  voice.rejoin();
  // the new connection has told no view yet
  applyFollowed(session.followers);
  updateVoiceControls();

  currentSession = session;
  storeSession(session);
  updateSessionInfo();
  setupOptionsBar(session);
  showComponentId = session.options?.component_id_display !== false;
  privateHandEnabled = isPrivateHand(session.options?.private_hand);
  showHandsEnabled =
    privateHandEnabled && session.options?.private_hand?.show_hands_to_other_players === true;
  borderShiftEnabled = session.options?.border_shift === true;
  // a name already on screen goes away with the option
  if (!showComponentId) counterInfoText = "";

  // la situation initiale n'est chargée qu'une seule fois. Le test sur
  // counters ne suffisait plus : une partie sans pion le relisait à chaque
  // message de session et remettait les dés à zéro
  if (!componentsLoaded) {
    componentsLoaded = true;
    loadComponents(session.components);
    // the private hand of the reader is read with the table, and like it
    // only once: the tokens it holds are known by their id, but not drawn
    myHand = (session.hand ?? []).map((token) => {
      const counter = createCounter(token);
      countersById.set(counter.name, counter);
      return counter;
    });
  }
  setHands(session.hands);
  // what the players show of their hand is told again with each session
  if (Array.isArray(session.shows)) {
    showsByOwner.clear();
    for (const show of session.shows) showsByOwner.set(show.owner, show);
  }
  renderShowZones();
  renderPrivateHand();

  // le setup en attente n'est lu qu'avec la situation initiale, comme elle. Le
  // serveur le vide des qu'il est applique : le relire a chaque message de
  // session ré-armerait la mise en place une seconde fois.
  if (!setupRead) {
    setupRead = true;
    pendingSetup = session.setup ?? [];
  }
  sessionSynced = true;
}

// Le serveur annonce l'état de la partie : démarrée ou non, et qui manque.
function applySessionStatus(message: SessionStatusEvent): void {
  isStarted = message.started;
  missingPlayers = message.missing_players ?? [];
  updateParticipants(message.participants);
  if (isStarted) pendingStart = false;
  updateLeaveLinks();
  updateSessionInfo();
}

// La partie a été archivée par son owner. Les joueurs restants deviennent des
// spectateurs : le jeu reste affiché, figé, et seul l'owner qui a cliqué repart.
function applySessionClosed(): void {
  isClosed = true;
  isWatcher = true;
  isOwner = false;
  // the players left are watchers now: they no longer write privately
  updateChatPartners();
  // nobody talks over a closed game
  voice.leave();
  updateVoiceControls();
  // une requête en vol attendait une réponse qui ne viendra plus
  clearPending();
  updateLeaveLinks();
  updateSessionInfo();
}

// -------------------------------------------------
// Initialisation
// -------------------------------------------------

// Le bouton de retour ramène sur l'onglet du jeu d'origine ; repli index.html
// si la page a été ouverte sans paramètre (lien direct, marque-page). Un bouton
// n'a pas de href : c'est le clic qui porte la navigation.
const leaveUrl = lobbyReturnUrl(originGameName());

function goToLobby(): void {
  window.location.assign(leaveUrl);
}

const backLink = document.getElementById("back-link");
if (backLink) {
  backLink.addEventListener("click", goToLobby);
}

// Le second bouton n'existe que pour l'owner : le serveur le dit dans l'événement
// de session, cette page se contente de le montrer ou de le cacher.
const closeLink = document.getElementById("close-link");

// Le bouton de démarrage n'est proposé qu'à l'owner, tant que la partie n'a pas
// commencé. Le serveur vérifie lui aussi l'owner : la page ne fait que suivre ce
// qu'il annonce. Une fois cliqué, le bouton attend la réponse du serveur.
const startLink = document.getElementById("start-link") as HTMLButtonElement | null;

// une demande de démarrage est-elle en vol ?
let pendingStart = false;

function updateLeaveLinks(): void {
  if (startLink) {
    startLink.hidden = !isOwner || isStarted || isWatcher || isClosed;
    startLink.disabled = pendingStart;
  }
  // the role and the closing of the game also decide of the options bar
  updateOptionsBar();
  // only the owner moves the names of the list of players
  renderParticipants();
  // and of the private hand, which a watcher does not have
  renderPrivateHand();
  if (!closeLink) return;
  closeLink.hidden = !isOwner || isClosed;
}

function onStartSession(): void {
  if (pendingStart || isStarted) return;
  if (!window.confirm(
    "Démarrer la partie ?\n\n" +
      "Plus aucun nouveau joueur ne pourra la rejoindre.",
  )) {
    return;
  }

  const socket = getSocket();
  if (!socket) {
    window.alert("Connexion au serveur impossible : la partie n'est pas démarrée.");
    return;
  }

  pendingStart = true;
  updateLeaveLinks();
  socket.send({ action: "start_session" });
  console.log("[WS] Envoyé :", JSON.stringify({ action: "start_session" }));
}

if (startLink) {
  startLink.addEventListener("click", onStartSession);
}

// l'owner a-t-il demandé la clôture ? c'est lui, et lui seul, qui part sur le
// lobby une fois la partie archivée
let pendingClose = false;

function onCloseSession(): void {
  if (!window.confirm(
    "Clore la partie ?\n\n" +
      "Elle sera archivée et ne pourra plus être rejouée. " +
      "Les joueurs encore connectés regarderont la partie telle qu'elle est.",
  )) {
    return;
  }

  const socket = getSocket();
  if (!socket) {
    window.alert("Connexion au serveur impossible : la partie reste ouverte.");
    return;
  }

  pendingClose = true;
  socket.send({ action: "close_session" });
  console.log("[WS] Envoyé :", JSON.stringify({ action: "close_session" }));
}

if (closeLink) {
  closeLink.hidden = true;
  closeLink.addEventListener("click", onCloseSession);
}

// -------------------------------------------------
// Copie d'écran
// -------------------------------------------------

// Le nom du fichier vient de l'URL et n'est donc pas maîtrisé : on n'en garde
// que ce qui est sûr dans un nom de fichier, pour ne pas produire un nom que le
// navigateur tronque ou refuse.
function screenshotFilename(): string {
  const game = (originGameName() ?? "partie").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  // deux parties lancées dans la même seconde ne doivent pas s'écraser
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `obg-${game || "partie"}-${stamp}.png`;
}

// Margin around the components, in world pixels: it leaves room for the shadow
// and the outline a token draws outside its rectangle.
const SCREENSHOT_MARGIN = 20;
// A browser refuses a canvas over its size limit, which differs from one
// browser to the next: the capture then shrinks by this factor and tries
// again, a few times.
const SCREENSHOT_SHRINK = 0.75;
const SCREENSHOT_ATTEMPTS = 6;

interface WorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// The rectangle of the world that holds every component of the game, where
// each one is drawn: boards, counters, bags, tokens out of the bags and dice.
// Null while the game has nothing to show.
function componentsBounds(): WorldRect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number, width: number, height: number): void => {
    const [dx, dy] = displayTopLeft(x, y, width, height);
    minX = Math.min(minX, dx);
    minY = Math.min(minY, dy);
    maxX = Math.max(maxX, dx + width);
    maxY = Math.max(maxY, dy + height);
  };

  for (const board of boards) {
    const { width, height } = boardDims(board);
    add(board.x, board.y, width, height);
  }
  for (const box of counterBoxes) add(box.x, box.y, box.width, box.height);
  for (const character of mwCharacters) add(character.x, character.y, character.width, character.height);
  for (const bag of bags) add(bag.x, bag.y, bag.width, bag.height);
  for (const dice of dices) add(dice.x, dice.y, dice.width, dice.height);
  for (const counter of counters) {
    // a turned token covers more than its upright rectangle
    const angle = (counter.orientation * Math.PI) / 180;
    const cos = Math.abs(Math.cos(angle));
    const sin = Math.abs(Math.sin(angle));
    const width = counter.width * cos + counter.height * sin;
    const height = counter.width * sin + counter.height * cos;
    add(
      counter.x + (counter.width - width) / 2,
      counter.y + (counter.height - height) / 2,
      width,
      height,
    );
  }

  if (minX === Infinity) return null;
  return {
    x: minX - SCREENSHOT_MARGIN,
    y: minY - SCREENSHOT_MARGIN,
    width: maxX - minX + 2 * SCREENSHOT_MARGIN,
    height: maxY - minY + 2 * SCREENSHOT_MARGIN,
  };
}

// The game alone, as the table shows it: no grid, no hover zone, no button, no
// info bar. The order is the one of draw().
// The decks at their place on screen: each pile, its buttons when asked for,
// and the caption of the deck.
function drawDecks(
  context: CanvasRenderingContext2D,
  targetedPiles: (DeckPile | null)[],
  withButtons: boolean,
): void {
  for (const deck of decks) {
    for (const pile of deck.piles) {
      const area = pileFootprint(deck, pile);
      drawAtDisplay(context, area.x, area.y, area.width, area.height, () => {
        drawPile(context, deck, pile, targetedPiles.includes(pile));
      });
    }
    if (withButtons) {
      for (const button of drawButtons(deck)) {
        drawAtDisplay(context, button.x, button.y, button.width, button.height, () => {
          drawDrawButton(context, button);
        });
      }
      for (const button of deckButtons(deck, dealPlayers())) {
        drawAtDisplay(context, button.x, button.y, button.width, button.height, () => {
          drawDeckButton(context, button);
        });
      }
    }
    const first = deck.piles[0];
    if (first !== undefined) {
      const area = pileFootprint(deck, first);
      drawAtDisplay(context, area.x, area.y, area.width, area.height, () => {
        drawDeckText(context, deck);
      });
    }
  }
}

function drawComponents(context: CanvasRenderingContext2D): void {
  for (const board of boards) {
    drawBoard(board, context);
  }
  for (const box of counterBoxes) {
    drawAtDisplay(context, box.x, box.y, box.width, box.height, () => {
      drawCounterBox(context, box);
    });
  }
  for (const character of mwCharacters) {
    drawAtDisplay(context, character.x, character.y, character.width, character.height, () => {
      drawMwCharacter(context, character);
    });
  }
  for (const bag of bags) {
    drawAtDisplay(context, bag.x, bag.y, bag.width, bag.height, () => {
      drawBag(context, bag, false);
    });
  }
  drawDecks(context, [], false);
  for (const counter of counters) {
    if (!counter.showsOriginGhost) continue;
    const originX = counter.originX;
    const originY = counter.originY;
    if (originX === null || originY === null) continue;
    drawAtDisplay(context, originX, originY, counter.width, counter.height, () => {
      counter.drawOriginGhost(context);
    });
  }
  for (const counter of counters) {
    if (counter.image.complete) drawCounterAtDisplay(counter, context);
  }
  for (const dice of dices) {
    const image = dice.face();
    if (!image?.complete) continue;
    drawAtDisplay(context, dice.x, dice.y, dice.width, dice.height, () => {
      context.drawImage(image, dice.x, dice.y, dice.width, dice.height);
    });
  }
}

// The whole game on a canvas of its own, at the given scale (1 is one image
// pixel per world pixel). Null when the browser cannot make that canvas.
function renderComponents(bounds: WorldRect, scale: number): HTMLCanvasElement | null {
  const surface = document.createElement("canvas");
  surface.width = Math.max(1, Math.round(bounds.width * scale));
  surface.height = Math.max(1, Math.round(bounds.height * scale));
  const context = surface.getContext("2d");
  if (context === null) return null;

  context.fillStyle = "gray";
  context.fillRect(0, 0, surface.width, surface.height);
  context.setTransform(scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale);
  drawComponents(context);
  return surface;
}

// The capture does not copy the game canvas: that one only holds what the
// camera shows, at its zoom. The game is drawn again on a canvas as large as
// the game itself, so the image has every component, on screen or not, at 1:1.
async function downloadScreenshot(): Promise<void> {
  const bounds = componentsBounds();
  if (bounds === null) return;

  let blob: Blob | null = null;
  let scale = 1;
  try {
    for (let attempt = 0; attempt < SCREENSHOT_ATTEMPTS && blob === null; attempt++) {
      // drawn before toBlob hands over to the game loop: the image is the
      // table at the time of the click
      const surface = renderComponents(bounds, scale);
      if (surface !== null) {
        blob = await new Promise<Blob | null>((resolve) => {
          surface.toBlob(resolve, "image/png");
        });
      }
      // no image and no error: the canvas is over the browser's size limit
      if (blob === null) scale *= SCREENSHOT_SHRINK;
    }
  } catch (error) {
    // Un canvas pollué — une image du jeu servie depuis un autre domaine — fait
    // jeter toBlob. Le joueur doit l'apprendre : sans quoi il reclique et
    // croirait à un bouton cassé.
    console.warn("[capture] Capture impossible", error);
  }

  if (blob === null) {
    window.alert(
      "Copie d'écran impossible.\n\n" +
        "Le jeu est peut-être trop grand pour ce navigateur, ou ses images " +
        "sont servies depuis un autre domaine, ce qui interdit de les lire.",
    );
    return;
  }

  // Le lien est jetable : il ne rejoint pas le document, il ne sert qu'à
  // déclencher le téléchargement.
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = screenshotFilename();
  link.click();
  // Libérer l'URL trop tôt annulerait le téléchargement dans certains
  // navigateurs : le clic n'a pas encore été pris en compte.
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

if (screenshotLink) {
  screenshotLink.addEventListener("click", () => {
    // no capture with a token in hand, nor a second one while the first is
    // still being encoded: a large image takes a moment
    if (capturing || hand.length > 0) return;
    capturing = true;
    updateScreenshotAvailability();
    void downloadScreenshot().finally(() => {
      capturing = false;
      updateScreenshotAvailability();
    });
  });
}

// The stored session only starts loading the pictures, behind the loading
// overlay: it is a snapshot of the last session message, older than the setup
// and every move since. The situation shown is the one the answer to
// resume_session brings, which componentsLoaded, still false, lets through.
loadComponents(currentSession?.components);
setupOptionsBar(currentSession);

// set once the player was disconnected for inactivity: the page no longer
// takes its seat back when the shared WebSocket reconnects
let idleDisconnected = false;

// A player who does nothing for too long leaves the game: the WebSocket is
// closed, so the server takes the player out of the session, as when the tab
// is closed. The seat stays: the player may come back later.
function disconnectForInactivity(): void {
  idleDisconnected = true;
  voice.leave();
  updateVoiceControls();
  clearPending();
  getSocket()?.drop();
  showDisconnectedPopup(() => window.location.reload(), goToLobby);
}

// The connection is only opened by the one game page of this browser: a
// second one would speak for the first on the shared WebSocket (see gameLock.ts).
function startConnection(): void {
  const socket = getSocket();
  if (!socket) return;
  socket.setMessageHandler(handleServerMessage);
  // une coupure annule la requête en attente : la main n'est plus verrouillée
  socket.setStateHandler((message) => {
    if (!message.connected) {
      clearPending();
      return;
    }
    // disconnected for inactivity: the WebSocket reconnects for the other
    // tabs, this page stays out of the session
    if (idleDisconnected) return;
    // le lobby et le jeu sont deux pages distinctes : le jeu ouvre sa propre
    // connexion, qui doit revendiquer la session avant tout acquire/move.
    if (currentSession?.key) {
      const identity = loadPlayerIdentity();
      socket.send({
        action: "resume_session",
        session_key: currentSession.key,
        // la session peut avoir ete retiree de la memoire apres le depart du
        // lobby : le code permet au serveur de la reconstruire
        session_code: currentSession.code,
        nickname: identity?.name ?? "Anonymous",
        role: identity?.role ?? "player",
      });
    }
  });
}

void acquireGameLock().then((acquired) => {
  if (acquired) {
    startConnection();
    // only the players of a started game are watched: a watcher, or a closed
    // game, holds no seat, and a player waiting for the others is not idle
    startIdleWatch({
      moveTarget: canvas,
      isWatched: () => isStarted && !isWatcher && !isClosed,
      onDisconnect: disconnectForInactivity,
    });
    return;
  }
  // The overlay stays up with the reason: this page never talks to the server.
  blockedByOtherTab = true;
  if (loadingText) loadingText.textContent = GAME_OPEN_ELSEWHERE_MESSAGE;
  if (loadingBar) loadingBar.hidden = true;
  if (loadingOverlay === null) window.alert(GAME_OPEN_ELSEWHERE_MESSAGE);
});

// -------------------------------------------------
// Boucle du jeu
// -------------------------------------------------

function gameLoop(): void {
  // Le temps réel, pas le temps disponible : deux rafraîchissements successifs
  // peuvent recevoir le même timestamp, et une frame longue ne doit pas non
  // plus faire sauter la carte d'un coup.
  const now = performance.now();
  const dt = lastFrameAt === 0 ? 0 : Math.min(EDGE_SCROLL_MAX_FRAME_MS, (now - lastFrameAt) / 1000);
  lastFrameAt = now;

  stepEdgeScroll(dt);
  followView(dt);
  draw();
  sendView(now);
  updateScreenshotAvailability();
  updateLoadingOverlay();
  flushMoves();
  window.requestAnimationFrame(gameLoop);
}

window.requestAnimationFrame(gameLoop);

// -------------------------------------------------
// Événements
// -------------------------------------------------

new ResizeObserver(fitCanvasSize).observe(canvas);

canvas.addEventListener("mousedown", onMouseDown);
canvas.addEventListener("dblclick", onDoubleClick);
canvas.addEventListener("mousemove", onMouseMove);
canvas.addEventListener("mouseup", onMouseUp);
canvas.addEventListener("mouseleave", onMouseLeave);
canvas.addEventListener("wheel", onMouseWheel, { passive: false });

// relâchement hors du canvas
window.addEventListener("mouseup", onMouseUp);
window.addEventListener("mousemove", onWindowMouseMove);
// the right button moves the camera: no context menu over the game
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
window.addEventListener("keydown", onKeyDown);

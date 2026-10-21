import type { DeckItem, DeckPileName } from "../types";
import type { Counter } from "./counter";

// Plain back drawn when the top card of a pile has no picture to show, or
// while that picture loads.
const FALLBACK_FILL = "#2f4f7f";
const FALLBACK_STROKE = "#16263f";
// An empty pile is only an outline: the place where cards go.
const EMPTY_FILL = "rgba(0, 0, 0, 0.12)";
const EMPTY_STROKE = "rgba(0, 0, 0, 0.6)";
// Outline shown while a held card hovers over a pile: releasing it there
// puts it on top.
const TARGET_COLOR = "orange";
// Cards under the top one, hinted by an edge sticking out: how far each edge
// is shifted, and how many are drawn at most.
const THICKNESS_STEP = 2;
const THICKNESS_MAX = 3;
// Badge with the number of cards of the pile, in its bottom-right corner. Its
// size follows the pile, within bounds that keep the number readable.
const BADGE_RATIO = 0.3;
const BADGE_MIN_SIZE = 18;
const BADGE_MAX_SIZE = 44;
// Buttons under each pile, one row each, as wide as the pile.
const BUTTON_HEIGHT = 22;
const BUTTON_GAP = 4;
const BUTTON_FILL = "#3a7";
// A button that would do nothing right now, like a deal without enough cards.
const BUTTON_DISABLED_FILL = "#999";
const BUTTON_FONT_MAX = 14;
// Width of the buttons of a pile turned by a quarter turn: they stand in a
// column on its right, where a turned pile usually has more room than below.
const SIDE_BUTTON_WIDTH = 90;
// Caption written above the deck when the game gives it a text.
const TEXT_SIZE = 16;
const TEXT_GAP = 6;

// The area of a stack, always shown: the cards lie centered inside it.
const AREA_FILL = "rgba(0, 0, 0, 0.12)";
const AREA_STROKE = "rgba(0, 0, 0, 0.6)";

// Buttons in the top-right corner of each pile: pressing one and moving away
// draws that many cards at once. The game chooses them (card_pickup_quantity);
// these are the ones of a server that does not say.
const DEFAULT_DRAW_COUNTS: readonly number[] = [2, 5, 10];
const DRAW_BUTTON_WIDTH = 28;
const DRAW_BUTTON_HEIGHT = 20;
const DRAW_BUTTON_GAP = 3;
const DRAW_BUTTON_MARGIN = 4;
const DRAW_BUTTON_FILL = "rgba(20, 20, 20, 0.85)";
const DRAW_BUTTON_DISABLED_FILL = "rgba(120, 120, 120, 0.7)";

export type DeckAction = "shuffle" | "refill" | "deal";

/** The buttons of each pile: both piles are shuffled, the discard pile also goes back to the draw. */
const PILE_ACTIONS: Record<DeckPileName, { action: DeckAction; label: string }[]> = {
  draw: [{ action: "shuffle", label: "Shuffle" }],
  discard: [
    { action: "shuffle", label: "Shuffle" },
    { action: "refill", label: "Refill" },
  ],
};

export interface DeckPile {
  readonly name: DeckPileName;
  x: number;
  y: number;
  /** number of cards of the pile: the server tells it, the cards stay there */
  count: number;
  /** what the top card shows on this pile; null on an empty pile or without picture */
  topImage: HTMLImageElement | null;
  /** size of the top card; null on an empty pile */
  topWidth: number | null;
  topHeight: number | null;
}

/**
 * A deck: a fixed component holding cards out of sight, in one pile
 * ("single") or in a draw pile and a discard pile ("duo"). A card released
 * over a pile goes on top of it, a click takes the top card out. The server
 * keeps the cards: the client only knows how many each pile holds and what
 * its top card shows.
 */
export interface Deck {
  readonly name: string;
  /**
   * A stack: one single pile that deals its cards to the private hands. Its
   * size is the one of its area, in which the cards are centered. A slot is
   * drawn the same way: the server sends it without any button.
   */
  readonly isStack: boolean;
  /** size of one pile, that is of one card; for a stack, of its area */
  readonly width: number;
  readonly height: number;
  /** caption written above the deck, or null when the game gives none */
  readonly text: string | null;
  /** how many cards each multi-draw button takes; empty, no button */
  readonly drawCounts: readonly number[];
  /** the piles that show the multi-draw buttons; null, every pile */
  readonly drawPiles: readonly string[] | null;
  /**
   * angle the piles are turned by around their center, in degrees: 0, 90,
   * 180 or 270. x, y, width and height are those of the pile before it is
   * turned; pileFootprint gives the rectangle it covers.
   */
  readonly orientation: number;
  /** a stack showing the Deal button: the game declares "deal": true */
  readonly deals: boolean;
  /** the piles show their Shuffle button: hidden only by "display_shuffle": false */
  readonly displayShuffle: boolean;
  piles: DeckPile[];
}

export interface DeckButton {
  readonly deck: Deck;
  readonly pile: DeckPile;
  readonly action: DeckAction;
  readonly label: string;
  /** false when a click would do nothing: the button is grayed out */
  readonly enabled: boolean;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DrawButton {
  readonly deck: Deck;
  readonly pile: DeckPile;
  /** how many cards the button draws */
  readonly count: number;
  /** false when the pile does not hold that many cards: the button is grayed out */
  readonly enabled: boolean;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// one picture per address: a pile is described again after each move of a
// card, and its picture must not be loaded again each time
const images = new Map<string, HTMLImageElement>();

function imageOf(src: string | null | undefined): HTMLImageElement | null {
  if (!src) return null;
  let image = images.get(src);
  if (image === undefined) {
    image = new Image();
    image.src = src;
    images.set(src, image);
  }
  return image;
}

function readPiles(item: DeckItem): DeckPile[] {
  const piles: DeckPile[] = [];
  for (const name of ["draw", "discard"] as const) {
    const pile = item.piles?.[name];
    if (!pile) continue;
    piles.push({
      name,
      x: pile.x,
      y: pile.y,
      count: pile.count,
      topImage: imageOf(pile.top?.src),
      topWidth: pile.top?.width ?? null,
      topHeight: pile.top?.height ?? null,
    });
  }
  return piles;
}

export function createDeck(item: DeckItem): Deck {
  return {
    name: item.id,
    // a slot is a stack where the cards keep their side: drawn the same way
    isStack: item.kind === "stack" || item.kind === "slot",
    width: item.width,
    height: item.height,
    text: typeof item.text === "string" && item.text !== "" ? item.text : null,
    drawCounts: readDrawCounts(item.card_pickup_quantity),
    drawPiles: Array.isArray(item.card_pickup_piles) ? item.card_pickup_piles : null,
    orientation: readOrientation(item.orientation),
    deals: item.kind === "stack" && item.deal === true,
    displayShuffle: item.display_shuffle !== false,
    piles: readPiles(item),
  };
}

// Mirrors read_deck_orientation on the server: a quarter turn, or upright.
function readOrientation(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const angle = ((Math.trunc(value) % 360) + 360) % 360;
  return angle % 90 === 0 ? angle : 0;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The rectangle a pile covers once turned: a quarter turn swaps its width
 * and height around the same center. Mirrors Deck.footprint on the server.
 */
export function pileFootprint(deck: Deck, pile: DeckPile): Rect {
  const quarter = deck.orientation === 90 || deck.orientation === 270;
  const width = quarter ? deck.height : deck.width;
  const height = quarter ? deck.width : deck.height;
  const centerX = pile.x + deck.width / 2;
  const centerY = pile.y + deck.height / 2;
  return { x: centerX - width / 2, y: centerY - height / 2, width, height };
}

// The server sends the buttons already cleaned; the client only guards
// against what it could not draw.
function readDrawCounts(value: unknown): readonly number[] {
  if (!Array.isArray(value)) return DEFAULT_DRAW_COUNTS;
  return value.filter((count): count is number => Number.isInteger(count) && count >= 1);
}

// The server describes the deck again each time a card moves or a pile is
// shuffled: the piles are simply read again.
export function updateDeck(deck: Deck, item: DeckItem): void {
  deck.piles = readPiles(item);
}

function inside(x: number, y: number, left: number, top: number, width: number, height: number): boolean {
  return left <= x && x <= left + width && top <= y && y <= top + height;
}

// The topmost pile under (x, y), or null: decks are drawn in list order.
export function pileAt(decks: Deck[], x: number, y: number): { deck: Deck; pile: DeckPile } | null {
  for (let i = decks.length - 1; i >= 0; i -= 1) {
    const deck = decks[i];
    for (const pile of deck.piles) {
      const area = pileFootprint(deck, pile);
      if (inside(x, y, area.x, area.y, area.width, area.height)) return { deck, pile };
    }
  }
  return null;
}

// Mirrors Session.deck_at on the server: a released card joins the pile its
// center lies on. Only a card goes into a deck.
export function pileUnder(decks: Deck[], counter: Counter): DeckPile | null {
  if (!counter.isCard) return null;
  return pileAt(decks, counter.x + counter.width / 2, counter.y + counter.height / 2)?.pile ?? null;
}

/**
 * The buttons of a deck, one row each under their pile, or beside it when
 * the deck is turned by a quarter turn.
 * @param dealTo the number of players a stack would deal to, or null when
 *   the game has no private hand: a stack then has no Deal button, nor
 *   when it does not declare "deal": true
 */
export function deckButtons(deck: Deck, dealTo: number | null): DeckButton[] {
  return deck.piles.flatMap((pile) => {
    const entries = PILE_ACTIONS[pile.name]
      .filter((entry) => entry.action !== "shuffle" || deck.displayShuffle)
      .map((entry) => ({ ...entry, enabled: true }));
    if (deck.isStack && deck.deals && dealTo !== null) {
      // a deal gives one card to each player, or none at all
      entries.push({ action: "deal", label: "Deal", enabled: dealTo > 0 && pile.count >= dealTo });
    }
    // the buttons stay upright: under the pile as it lies on the table, or in
    // a column on its right when it is turned by a quarter turn
    const area = pileFootprint(deck, pile);
    const beside = deck.orientation === 90 || deck.orientation === 270;
    return entries.map((entry, row) => ({
      deck,
      pile,
      action: entry.action,
      label: entry.label,
      enabled: entry.enabled,
      x: beside ? area.x + area.width + BUTTON_GAP : area.x,
      y: beside
        ? area.y + row * (BUTTON_HEIGHT + BUTTON_GAP)
        : area.y + area.height + BUTTON_GAP + row * (BUTTON_HEIGHT + BUTTON_GAP),
      width: beside ? SIDE_BUTTON_WIDTH : area.width,
      height: BUTTON_HEIGHT,
    }));
  });
}

// The draw buttons of a deck: one row in the top-right corner of each pile,
// narrowed when the pile is too small for all of them at full width.
export function drawButtons(deck: Deck): DrawButton[] {
  const counts = deck.drawCounts;
  if (counts.length === 0) return [];
  const piles = deck.piles.filter((pile) => deck.drawPiles === null || deck.drawPiles.includes(pile.name));
  return piles.flatMap((pile) => {
    // upright, in the top-right corner of the pile as it lies on the table
    const area = pileFootprint(deck, pile);
    const room = area.width - 2 * DRAW_BUTTON_MARGIN - (counts.length - 1) * DRAW_BUTTON_GAP;
    const width = Math.max(4, Math.min(DRAW_BUTTON_WIDTH, room / counts.length));
    const height = Math.min(DRAW_BUTTON_HEIGHT, area.height / 3);
    return counts.map((count, column) => ({
      deck,
      pile,
      count,
      enabled: pile.count >= count,
      // the last button ends at the right margin of the pile
      x:
        area.x + area.width - DRAW_BUTTON_MARGIN - width -
        (counts.length - 1 - column) * (width + DRAW_BUTTON_GAP),
      y: area.y + DRAW_BUTTON_MARGIN,
      width,
      height,
    }));
  });
}

export function drawButtonAt(decks: Deck[], x: number, y: number): DrawButton | null {
  for (let i = decks.length - 1; i >= 0; i -= 1) {
    for (const button of drawButtons(decks[i])) {
      if (inside(x, y, button.x, button.y, button.width, button.height)) return button;
    }
  }
  return null;
}

export function drawDrawButton(ctx: CanvasRenderingContext2D, button: DrawButton): void {
  ctx.save();
  ctx.fillStyle = button.enabled ? DRAW_BUTTON_FILL : DRAW_BUTTON_DISABLED_FILL;
  ctx.fillRect(button.x, button.y, button.width, button.height);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "white";
  ctx.strokeRect(button.x, button.y, button.width, button.height);
  ctx.fillStyle = "white";
  ctx.font = `bold ${Math.max(8, Math.floor(button.height * 0.65))}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(button.count), button.x + button.width / 2, button.y + button.height / 2, button.width - 2);
  ctx.restore();
}

export function deckButtonAt(decks: Deck[], x: number, y: number, dealTo: number | null): DeckButton | null {
  for (let i = decks.length - 1; i >= 0; i -= 1) {
    for (const button of deckButtons(decks[i], dealTo)) {
      if (inside(x, y, button.x, button.y, button.width, button.height)) return button;
    }
  }
  return null;
}

// The pile of a stack: its area, and the cards centered inside it at their own
// size, whatever the size of the area.
function drawStackCards(ctx: CanvasRenderingContext2D, deck: Deck, pile: DeckPile): void {
  ctx.fillStyle = AREA_FILL;
  ctx.fillRect(pile.x, pile.y, deck.width, deck.height);
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = AREA_STROKE;
  ctx.strokeRect(pile.x, pile.y, deck.width, deck.height);
  ctx.setLineDash([]);
  if (pile.count === 0) return;

  const width = pile.topWidth ?? deck.width;
  const height = pile.topHeight ?? deck.height;
  const x = pile.x + (deck.width - width) / 2;
  const y = pile.y + (deck.height - height) / 2;
  // the cards under the top one, deepest first
  const edges = Math.min(THICKNESS_MAX, pile.count - 1);
  for (let edge = edges; edge >= 1; edge -= 1) {
    const shift = edge * THICKNESS_STEP;
    ctx.fillStyle = "#ddd";
    ctx.fillRect(x + shift, y + shift, width, height);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#555";
    ctx.strokeRect(x + shift, y + shift, width, height);
  }
  const image = pile.topImage;
  if (image !== null && image.complete && image.naturalWidth > 0) {
    ctx.drawImage(image, x, y, width, height);
  } else {
    ctx.fillStyle = FALLBACK_FILL;
    ctx.fillRect(x, y, width, height);
    ctx.lineWidth = 3;
    ctx.strokeStyle = FALLBACK_STROKE;
    ctx.strokeRect(x, y, width, height);
  }
}

/**
 * Draws one pile: its top card, the edges of the cards under it and the
 * number of cards it holds.
 * @param targeted a held card hovers over the pile and would go on top of it
 */
export function drawPile(
  ctx: CanvasRenderingContext2D,
  deck: Deck,
  pile: DeckPile,
  targeted: boolean,
): void {
  const { x, y } = pile;
  const { width, height } = deck;
  ctx.save();
  // the cards are drawn turned around the center of the pile
  if (deck.orientation !== 0) {
    ctx.translate(x + width / 2, y + height / 2);
    ctx.rotate((deck.orientation * Math.PI) / 180);
    ctx.translate(-(x + width / 2), -(y + height / 2));
  }

  if (deck.isStack) {
    drawStackCards(ctx, deck, pile);
  } else if (pile.count === 0) {
    ctx.fillStyle = EMPTY_FILL;
    ctx.fillRect(x, y, width, height);
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = EMPTY_STROKE;
    ctx.strokeRect(x, y, width, height);
    ctx.setLineDash([]);
  } else {
    // the cards under the top one, deepest first
    const edges = Math.min(THICKNESS_MAX, pile.count - 1);
    for (let edge = edges; edge >= 1; edge -= 1) {
      const shift = edge * THICKNESS_STEP;
      ctx.fillStyle = "#ddd";
      ctx.fillRect(x + shift, y + shift, width, height);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#555";
      ctx.strokeRect(x + shift, y + shift, width, height);
    }
    const image = pile.topImage;
    if (image !== null && image.complete && image.naturalWidth > 0) {
      ctx.drawImage(image, x, y, width, height);
    } else {
      ctx.fillStyle = FALLBACK_FILL;
      ctx.fillRect(x, y, width, height);
      ctx.lineWidth = 3;
      ctx.strokeStyle = FALLBACK_STROKE;
      ctx.strokeRect(x, y, width, height);
    }
  }

  if (targeted) {
    ctx.lineWidth = 5;
    ctx.strokeStyle = TARGET_COLOR;
    ctx.strokeRect(x, y, width, height);
  }
  ctx.restore();
  ctx.save();

  // the badge stays upright, in the bottom-right corner of the turned pile
  const area = pileFootprint(deck, pile);
  const size = Math.max(BADGE_MIN_SIZE, Math.min(BADGE_MAX_SIZE, Math.min(width, height) * BADGE_RATIO));
  const centerX = area.x + area.width - size / 2;
  const centerY = area.y + area.height - size / 2;
  ctx.beginPath();
  ctx.arc(centerX, centerY, size / 2, 0, Math.PI * 2);
  // an empty pile reads at a glance: its badge turns gray
  ctx.fillStyle = pile.count > 0 ? "black" : "gray";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "white";
  ctx.stroke();
  ctx.fillStyle = "white";
  ctx.font = `bold ${Math.round(size * 0.55)}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(pile.count), centerX, centerY);

  ctx.restore();
}

export function drawDeckButton(ctx: CanvasRenderingContext2D, button: DeckButton): void {
  ctx.save();
  ctx.fillStyle = button.enabled ? BUTTON_FILL : BUTTON_DISABLED_FILL;
  ctx.fillRect(button.x, button.y, button.width, button.height);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "black";
  ctx.strokeRect(button.x, button.y, button.width, button.height);
  ctx.fillStyle = "white";
  // the label must fit a narrow card
  const fontSize = Math.min(BUTTON_FONT_MAX, Math.floor(button.width / 4.5));
  ctx.font = `${Math.max(8, fontSize)}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(button.label, button.x + button.width / 2, button.y + button.height / 2, button.width - 4);
  ctx.restore();
}

// The caption of the deck, above its draw pile.
export function drawDeckText(ctx: CanvasRenderingContext2D, deck: Deck): void {
  const pile = deck.piles[0];
  if (deck.text === null || pile === undefined) return;
  ctx.save();
  ctx.font = `bold ${TEXT_SIZE}px Arial`;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "white";
  ctx.fillStyle = "black";
  // the white outline keeps the caption readable on any board; it stays
  // upright, above the pile as it lies on the table
  const area = pileFootprint(deck, pile);
  ctx.strokeText(deck.text, area.x, area.y - TEXT_GAP);
  ctx.fillText(deck.text, area.x, area.y - TEXT_GAP);
  ctx.restore();
}

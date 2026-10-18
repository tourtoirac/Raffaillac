import type { MwCharacterColumnItem, MwCharacterItem, TokenItem } from "../types";

// An mw_character is a card that never moves, with a column of boxes on each
// side, an icon on top of each column. The boxes are kept by the server: a
// click only asks it to move a box on to its next state. The columns are only
// drawn, and only clicked, on the front of the card.

export type MwCharacterColumnName = "left" | "right";

// Where the columns lie on the card, as parts of its width and height: in
// the margins of the War of the Ring character cards, on each side of the
// table of their ratings.
const BOX_SIZE_RATIO = 0.075; // of the width
const BOX_GAP_RATIO = 0.015; // of the width
const SIDE_MARGIN_RATIO = 0.01; // of the width
const TOP_RATIO = 0.36; // of the height

const BOX_FILL = "rgba(255, 255, 255, 0.85)";
const BOX_STROKE = "#222222";
const MARK_COLOR = "#b00000";
// the badge counting the cards under the character, across its top-right corner
const BADGE_RATIO = 0.16; // of the width
const BADGE_FILL = "#1e1e1e";
const BADGE_STROKE = "#ffd700";
const RING_COLOR = "#1a3f9c";

export interface MwCharacterColumn {
  readonly icon: HTMLImageElement | null;
  readonly boxes: number;
  /** the state of each box: left 0 empty, 1 slash, 2 cross; right 0 empty, 1 circle */
  marks: number[];
}

/** A card lying under a character: its front is read by everybody. */
export interface CharacterCard {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly front: HTMLImageElement;
}

export interface MwCharacter {
  readonly name: string;
  // the setup of the game may move it, like a counter
  x: number;
  y: number;
  readonly width: number;
  readonly height: number;
  readonly front: HTMLImageElement;
  readonly back: HTMLImageElement | null;
  side: "front" | "back";
  /** only the players of this nationality mark and turn it; null, anybody */
  readonly nationality: string | null;
  readonly columns: Partial<Record<MwCharacterColumnName, MwCharacterColumn>>;
  /** the cards under it, the last one put (the first taken back) at the end */
  cards: CharacterCard[];
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function loadImage(src: string | null | undefined): HTMLImageElement | null {
  if (!src) return null;
  const image = new Image();
  image.src = src;
  return image;
}

function createColumn(item: MwCharacterColumnItem | undefined): MwCharacterColumn | undefined {
  if (!item || typeof item.boxes !== "number") return undefined;
  const marks = Array.from({ length: item.boxes }, (_, index) => item.marks?.[index] ?? 0);
  return { icon: loadImage(item.icon), boxes: item.boxes, marks };
}

/** The cards under a character, as the server described them. */
export function readCharacterCards(items: TokenItem[] | undefined): CharacterCard[] {
  return (items ?? []).map((item) => ({
    id: item.id,
    width: item.width,
    height: item.height,
    front: loadImage(item.front_src ?? item.back_src) ?? new Image(),
  }));
}

export function createMwCharacter(item: MwCharacterItem): MwCharacter {
  const columns: Partial<Record<MwCharacterColumnName, MwCharacterColumn>> = {};
  const left = createColumn(item.left);
  const right = createColumn(item.right);
  if (left) columns.left = left;
  if (right) columns.right = right;
  return {
    name: item.id,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    front: loadImage(item.front_src) ?? new Image(),
    back: loadImage(item.back_src),
    side: item.side === "back" && item.back_src ? "back" : "front",
    nationality: item.nationality ?? null,
    columns,
    cards: readCharacterCards(item.cards),
  };
}

export function isFlippable(character: MwCharacter): boolean {
  return character.back !== null;
}

/**
 * The rectangles of a column: its icon first, then each of its boxes, from
 * the top down.
 */
export function columnRects(character: MwCharacter, name: MwCharacterColumnName): Rect[] {
  const column = character.columns[name];
  if (!column) return [];
  const size = character.width * BOX_SIZE_RATIO;
  const gap = character.width * BOX_GAP_RATIO;
  const margin = character.width * SIDE_MARGIN_RATIO;
  const x = name === "left" ? character.x + margin : character.x + character.width - margin - size;
  const top = character.y + character.height * TOP_RATIO;
  return Array.from({ length: column.boxes + 1 }, (_, row) => ({
    x,
    y: top + row * (size + gap),
    width: size,
    height: size,
  }));
}

/** The box under the pointer, or null: the icon is not a box. */
export function boxAt(
  character: MwCharacter,
  x: number,
  y: number,
): { column: MwCharacterColumnName; index: number } | null {
  if (character.side !== "front") return null;
  for (const name of ["left", "right"] as const) {
    const rects = columnRects(character, name);
    for (let row = 1; row < rects.length; row += 1) {
      const rect = rects[row];
      if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) {
        return { column: name, index: row - 1 };
      }
    }
  }
  return null;
}

/** The card under the pointer, or null; the last drawn is on top. */
export function hitMwCharacter(characters: MwCharacter[], x: number, y: number): MwCharacter | null {
  for (let i = characters.length - 1; i >= 0; i -= 1) {
    const character = characters[i];
    if (
      x >= character.x &&
      x <= character.x + character.width &&
      y >= character.y &&
      y <= character.y + character.height
    ) {
      return character;
    }
  }
  return null;
}

function drawMark(ctx: CanvasRenderingContext2D, rect: Rect, name: MwCharacterColumnName, mark: number): void {
  if (mark === 0) return;
  const inset = rect.width * 0.18;
  ctx.lineWidth = Math.max(1, rect.width * 0.12);
  ctx.lineCap = "round";
  if (name === "right") {
    // fatigue: a circle
    ctx.strokeStyle = RING_COLOR;
    ctx.beginPath();
    ctx.arc(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width / 2 - inset, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  // wounds: a slash, then a cross
  ctx.strokeStyle = MARK_COLOR;
  ctx.beginPath();
  ctx.moveTo(rect.x + inset, rect.y + rect.height - inset);
  ctx.lineTo(rect.x + rect.width - inset, rect.y + inset);
  if (mark >= 2) {
    ctx.moveTo(rect.x + inset, rect.y + inset);
    ctx.lineTo(rect.x + rect.width - inset, rect.y + rect.height - inset);
  }
  ctx.stroke();
}

// How many cards lie under the character, on both faces: a round badge
// across its top-right corner.
function drawCardCount(ctx: CanvasRenderingContext2D, character: MwCharacter): void {
  if (character.cards.length === 0) return;
  const radius = (character.width * BADGE_RATIO) / 2;
  const centerX = character.x + character.width - radius * 0.6;
  const centerY = character.y + radius * 0.6;
  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fillStyle = BADGE_FILL;
  ctx.fill();
  ctx.lineWidth = Math.max(1, radius * 0.15);
  ctx.strokeStyle = BADGE_STROKE;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${Math.round(radius * 1.2)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(character.cards.length), centerX, centerY + radius * 0.05);
  ctx.restore();
}

/** The card, and on its front the two columns with their icon and marks. */
export function drawMwCharacter(ctx: CanvasRenderingContext2D, character: MwCharacter): void {
  const image = character.side === "back" && character.back ? character.back : character.front;
  if (image.complete && image.naturalWidth > 0) {
    ctx.drawImage(image, character.x, character.y, character.width, character.height);
  }
  drawCardCount(ctx, character);
  if (character.side !== "front") return;

  ctx.save();
  for (const name of ["left", "right"] as const) {
    const column = character.columns[name];
    if (!column) continue;
    const rects = columnRects(character, name);
    const [iconRect, ...boxRects] = rects;
    if (column.icon?.complete && column.icon.naturalWidth > 0) {
      ctx.drawImage(column.icon, iconRect.x, iconRect.y, iconRect.width, iconRect.height);
    }
    boxRects.forEach((rect, index) => {
      ctx.fillStyle = BOX_FILL;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.strokeStyle = BOX_STROKE;
      ctx.lineWidth = Math.max(0.5, rect.width * 0.06);
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
      drawMark(ctx, rect, name, column.marks[index] ?? 0);
    });
  }
  ctx.restore();
}

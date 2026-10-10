import type { BagItem } from "../types";
import type { Counter } from "./counter";

// Plain box drawn when the game gives the bag no picture, or while it loads.
const FALLBACK_FILL = "#6b4a2b";
const FALLBACK_STROKE = "#3a2614";
// Outline shown while a held token hovers over the bag: releasing it there
// drops it in.
const TARGET_COLOR = "orange";
// Badge with the number of tokens left, in the bottom-right corner. Its size
// follows the bag, within bounds that keep the number readable.
const BADGE_RATIO = 0.3;
const BADGE_MIN_SIZE = 18;
const BADGE_MAX_SIZE = 44;

/**
 * A bag: a fixed component holding tokens out of sight. A token released over
 * it joins its content, a click takes one out at random. The server chooses
 * the token; the client only keeps the content to show how many are left and
 * to have their pictures loaded before they come out.
 */
export interface Bag {
  readonly name: string;
  /** picture of the bag, or null when the game gives none */
  readonly image: HTMLImageElement | null;
  // the setup of the game may move a bag
  x: number;
  y: number;
  readonly width: number;
  readonly height: number;
  /** the tokens inside: they are not on the table and are never drawn */
  content: Counter[];
}

export function createBag(item: BagItem, content: Counter[]): Bag {
  let image: HTMLImageElement | null = null;
  if (item.src) {
    image = new Image();
    image.src = item.src;
  }
  return {
    name: item.id,
    image,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    content,
  };
}

export function bagContains(bag: Bag, x: number, y: number): boolean {
  return bag.x <= x && x <= bag.x + bag.width && bag.y <= y && y <= bag.y + bag.height;
}

// The topmost bag under (x, y), or null: bags are drawn in list order.
export function hitBag(bags: Bag[], x: number, y: number): Bag | null {
  for (let i = bags.length - 1; i >= 0; i -= 1) {
    if (bagContains(bags[i], x, y)) return bags[i];
  }
  return null;
}

// Mirrors Session.bag_at on the server: a released token falls into the bag
// its center lies on.
export function bagUnder(bags: Bag[], counter: Counter): Bag | null {
  return hitBag(bags, counter.x + counter.width / 2, counter.y + counter.height / 2);
}

/**
 * Draws the bag and the number of tokens it holds.
 * @param targeted a held token hovers over the bag and would fall into it
 */
export function drawBag(ctx: CanvasRenderingContext2D, bag: Bag, targeted: boolean): void {
  ctx.save();

  if (bag.image !== null && bag.image.complete && bag.image.naturalWidth > 0) {
    ctx.drawImage(bag.image, bag.x, bag.y, bag.width, bag.height);
  } else {
    ctx.fillStyle = FALLBACK_FILL;
    ctx.fillRect(bag.x, bag.y, bag.width, bag.height);
    ctx.lineWidth = 3;
    ctx.strokeStyle = FALLBACK_STROKE;
    ctx.strokeRect(bag.x, bag.y, bag.width, bag.height);
  }

  if (targeted) {
    ctx.lineWidth = 5;
    ctx.strokeStyle = TARGET_COLOR;
    ctx.strokeRect(bag.x, bag.y, bag.width, bag.height);
  }

  const size = Math.max(
    BADGE_MIN_SIZE,
    Math.min(BADGE_MAX_SIZE, Math.min(bag.width, bag.height) * BADGE_RATIO),
  );
  const centerX = bag.x + bag.width - size / 2;
  const centerY = bag.y + bag.height - size / 2;
  ctx.beginPath();
  ctx.arc(centerX, centerY, size / 2, 0, Math.PI * 2);
  // an empty bag reads at a glance: its badge turns gray
  ctx.fillStyle = bag.content.length > 0 ? "black" : "gray";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "white";
  ctx.stroke();

  ctx.fillStyle = "white";
  ctx.font = `bold ${Math.round(size * 0.55)}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(bag.content.length), centerX, centerY);

  ctx.restore();
}

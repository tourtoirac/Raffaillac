import { readNationality } from "./nationality";
import type { Nationality } from "./nationality";
import type { SecretChoiceItem } from "../types";

// A secret_choice is drawn, not loaded: a tile that shows the chosen value
// once this screen may know it, and its back (an eye) until then. Under it,
// the players who choose get one action icon: validate once a value is
// chosen, then the eye that reveals it. The server keeps the chosen value
// from whoever may not know it yet: choice is then null here.

export interface SecretChoice {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly choices: readonly string[];
  /** only the players of these nationalities choose; null, any player */
  readonly nationality: Nationality;
  choice: string | null;
  validated: boolean;
  revealed: boolean;
}

/** What a click on a secret_choice aims at: the tile, or the action icon under it. */
export type SecretChoiceTarget = "tile" | "validate" | "reveal";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const BACK = "#2b2b2b";
const BACK_ICON = "#f0f0f0";
const FACE = "#fdf8ec";
const FACE_TEXT = "#202020";
// frame of the value chosen and not validated yet
const SELECTED = "#f2c94c";
// frame of the value validated; on the back, tells the others it is chosen
const VALIDATED = "#3fa66b";
// frame of the value revealed
const REVEALED = "#d64545";
const ICON_FILL = "#e8e8e8";
const ICON_LINE = "#202020";
// the action icon: its side and its gap to the tile, as shares of the tile width
const ICON_RATIO = 0.6;
const ICON_GAP_RATIO = 0.1;

export function createSecretChoice(item: SecretChoiceItem): SecretChoice {
  return {
    name: item.id,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    choices: Array.isArray(item.choices) ? [...item.choices] : [],
    nationality: readNationality(item.nationality),
    choice: item.choice ?? null,
    validated: item.validated === true,
    revealed: item.revealed === true,
  };
}

// The server described the component again: only the state of the choice changes.
export function updateSecretChoice(secret: SecretChoice, item: SecretChoiceItem): void {
  secret.choice = item.choice ?? null;
  secret.validated = item.validated === true;
  secret.revealed = item.revealed === true;
}

/** Whether the value may still be chosen: until it is validated. */
export function canChoose(secret: SecretChoice): boolean {
  return !secret.validated;
}

/** The action the icon under the tile offers now, to the players who choose; null, no icon. */
export function pendingAction(secret: SecretChoice): "validate" | "reveal" | null {
  if (secret.choice !== null && !secret.validated) return "validate";
  if (secret.validated && !secret.revealed) return "reveal";
  return null;
}

function iconRect(secret: SecretChoice): Rect {
  const side = secret.width * ICON_RATIO;
  return {
    x: secret.x + (secret.width - side) / 2,
    y: secret.y + secret.height + secret.width * ICON_GAP_RATIO,
    width: side,
    height: side,
  };
}

function inside(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/**
 * What the pointer aims at on that secret_choice, or null. mine: the screen of
 * a player who chooses, the only one with an action icon.
 */
export function secretChoiceTargetAt(
  secret: SecretChoice,
  x: number,
  y: number,
  mine: boolean,
): SecretChoiceTarget | null {
  if (inside(secret, x, y)) return "tile";
  const action = mine ? pendingAction(secret) : null;
  if (action !== null && inside(iconRect(secret), x, y)) return action;
  return null;
}

/** The secret_choice under the pointer and what is aimed at; the last drawn is on top. */
export function hitSecretChoice(
  list: SecretChoice[],
  x: number,
  y: number,
  mine: (secret: SecretChoice) => boolean,
): { secret: SecretChoice; target: SecretChoiceTarget } | null {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const target = secretChoiceTargetAt(list[i], x, y, mine(list[i]));
    if (target !== null) return { secret: list[i], target };
  }
  return null;
}

function drawCheck(ctx: CanvasRenderingContext2D, rect: Rect): void {
  ctx.beginPath();
  ctx.moveTo(rect.x + rect.width * 0.22, rect.y + rect.height * 0.52);
  ctx.lineTo(rect.x + rect.width * 0.42, rect.y + rect.height * 0.72);
  ctx.lineTo(rect.x + rect.width * 0.78, rect.y + rect.height * 0.3);
  ctx.stroke();
}

function drawEye(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rect.width * 0.36, rect.height * 0.21, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, rect.height * 0.11, 0, Math.PI * 2);
  ctx.fill();
}

function frame(ctx: CanvasRenderingContext2D, rect: Rect, color: string): void {
  const width = Math.max(1, rect.width * 0.07);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.strokeRect(rect.x + width / 2, rect.y + width / 2, rect.width - width, rect.height - width);
}

/**
 * Draws the tile, and the action icon under it on the screen of a player who
 * chooses (mine).
 */
export function drawSecretChoice(ctx: CanvasRenderingContext2D, secret: SecretChoice, mine: boolean): void {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // the value, as far as this screen knows it: the server sends null otherwise
  const shown = secret.choice;
  if (shown !== null) {
    ctx.fillStyle = FACE;
    ctx.fillRect(secret.x, secret.y, secret.width, secret.height);
    ctx.fillStyle = FACE_TEXT;
    ctx.font = `bold ${Math.round(secret.height * 0.62)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(shown, secret.x + secret.width / 2, secret.y + secret.height * 0.54);
    frame(ctx, secret, secret.revealed ? REVEALED : secret.validated ? VALIDATED : SELECTED);
  } else {
    // the back: the eye of the reveal; framed in green once a value is validated
    ctx.fillStyle = BACK;
    ctx.fillRect(secret.x, secret.y, secret.width, secret.height);
    ctx.strokeStyle = BACK_ICON;
    ctx.fillStyle = BACK_ICON;
    ctx.lineWidth = Math.max(1, secret.width * 0.06);
    drawEye(ctx, secret);
    if (secret.validated) frame(ctx, secret, VALIDATED);
  }

  const action = mine ? pendingAction(secret) : null;
  if (action !== null) {
    const rect = iconRect(secret);
    ctx.fillStyle = ICON_FILL;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = ICON_LINE;
    ctx.fillStyle = ICON_LINE;
    ctx.lineWidth = Math.max(1, rect.width * 0.09);
    if (action === "validate") drawCheck(ctx, rect);
    else drawEye(ctx, rect);
  }
  ctx.restore();
}

/** The rectangle the tile and its action icon cover, for the framing of the view. */
export function secretChoiceBounds(secret: SecretChoice): Rect {
  const icon = iconRect(secret);
  return { x: secret.x, y: secret.y, width: secret.width, height: icon.y + icon.height - secret.y };
}

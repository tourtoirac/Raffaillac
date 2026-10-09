import type { HexGridItem } from "../types";

// Hex grid laid over a board. Tourtoirac snaps a released token onto the
// nearest hex center (Components/hex_grid.py): the client only previews the
// target hex while a token is held, and can draw the whole grid to calibrate
// it. The two computations must stay identical.

const SQRT3 = Math.sqrt(3);

export interface HexGrid {
  orientation: "flat" | "pointy";
  /** center of one hex, relative to the board's top-left corner */
  originX: number;
  originY: number;
  /** center-to-corner radius, horizontally and vertically */
  sizeX: number;
  sizeY: number;
  /** no snap beyond this distance from the center; null means no limit */
  snapRadius: number | null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The grid of a board, or null when absent or malformed, as on the server. */
export function readHexGrid(item: HexGridItem | null | undefined): HexGrid | null {
  if (!item || typeof item !== "object") return null;
  if ((item.type ?? "hex") !== "hex") return null;
  const orientation = item.orientation ?? "flat";
  if (orientation !== "flat" && orientation !== "pointy") return null;
  const originX = readNumber(item.origin_x);
  const originY = readNumber(item.origin_y);
  const size = readNumber(item.size);
  if (originX === null || originY === null || size === null || size <= 0) return null;
  const sizeY = readNumber(item.size_y);
  if (sizeY !== null && sizeY <= 0) return null;
  const radius = readNumber(item.snap_radius);
  return {
    orientation,
    originX,
    originY,
    sizeX: size,
    sizeY: sizeY ?? size,
    snapRadius: radius !== null && radius > 0 ? radius : null,
  };
}

// rounds fractional axial coordinates to the hex that contains them, through
// cube coordinates so that points near a corner pick the right neighbour
function cubeRound(q: number, r: number): [number, number] {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) {
    rq = -rr - rs;
  } else if (dr > ds) {
    rr = -rq - rs;
  }
  return [rq, rr];
}

// center of the hex of axial coordinates (q, r), relative to the board
function axialCenter(grid: HexGrid, q: number, r: number): [number, number] {
  const [cx, cy] =
    grid.orientation === "pointy"
      ? [SQRT3 * (q + r / 2), 1.5 * r]
      : [1.5 * q, SQRT3 * (r + q / 2)];
  return [grid.originX + cx * grid.sizeX, grid.originY + cy * grid.sizeY];
}

/** Center of the hex containing (x, y); both relative to the board. */
export function nearestHexCenter(grid: HexGrid, x: number, y: number): [number, number] {
  const px = (x - grid.originX) / grid.sizeX;
  const py = (y - grid.originY) / grid.sizeY;
  const [q, r] =
    grid.orientation === "pointy"
      ? cubeRound((SQRT3 / 3) * px - py / 3, (2 / 3) * py)
      : cubeRound((2 / 3) * px, -px / 3 + (SQRT3 / 3) * py);
  return axialCenter(grid, q, r);
}

/** Where a point dropped at (x, y) lands, or null beyond the snap radius. */
export function snapToHex(grid: HexGrid, x: number, y: number): [number, number] | null {
  const [cx, cy] = nearestHexCenter(grid, x, y);
  if (grid.snapRadius !== null && Math.hypot(cx - x, cy - y) > grid.snapRadius) return null;
  return [cx, cy];
}

/** Adds the outline of the hex centered on (cx, cy) to the current path. */
export function traceHex(ctx: CanvasRenderingContext2D, grid: HexGrid, cx: number, cy: number): void {
  // flat top: corners at 0°, 60°…; pointed top: shifted by 30°
  const offset = grid.orientation === "pointy" ? Math.PI / 6 : 0;
  for (let i = 0; i < 6; i += 1) {
    const angle = offset + (i * Math.PI) / 3;
    const x = cx + grid.sizeX * Math.cos(angle);
    const y = cy + grid.sizeY * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * Adds every hex whose center lies in the rectangle (relative to the board) to
 * the current path. Used to draw the grid over the board when calibrating it.
 */
export function traceHexesIn(
  ctx: CanvasRenderingContext2D,
  grid: HexGrid,
  left: number,
  top: number,
  right: number,
  bottom: number,
): void {
  // axial bounds of the rectangle, widened by one hex on every side
  const corners = [
    [left, top],
    [right, top],
    [left, bottom],
    [right, bottom],
  ].map(([x, y]) => {
    const px = (x - grid.originX) / grid.sizeX;
    const py = (y - grid.originY) / grid.sizeY;
    return grid.orientation === "pointy"
      ? [(SQRT3 / 3) * px - py / 3, (2 / 3) * py]
      : [(2 / 3) * px, -px / 3 + (SQRT3 / 3) * py];
  });
  const qs = corners.map(([q]) => q);
  const rs = corners.map(([, r]) => r);
  const qMin = Math.floor(Math.min(...qs)) - 1;
  const qMax = Math.ceil(Math.max(...qs)) + 1;
  const rMin = Math.floor(Math.min(...rs)) - 1;
  const rMax = Math.ceil(Math.max(...rs)) + 1;

  for (let q = qMin; q <= qMax; q += 1) {
    for (let r = rMin; r <= rMax; r += 1) {
      const [cx, cy] = axialCenter(grid, q, r);
      if (cx < left || cx > right || cy < top || cy > bottom) continue;
      traceHex(ctx, grid, cx, cy);
    }
  }
}

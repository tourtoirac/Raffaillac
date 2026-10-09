import type { BoardGroupItem, BoardItem } from "../types";
import { readHexGrid } from "./hex_grid";
import type { HexGrid } from "./hex_grid";

export interface Board {
  /** id du plateau dans le game_json : le setup s'en sert pour le deplacer */
  name: string;
  image: HTMLImageElement;
  x: number;
  y: number;
  width: number;
  height: number;
  /** hex grid of the map, or null */
  grid: HexGrid | null;
  /** the board_group this board belongs to, turned over with it; null when alone */
  group: BoardGroup | null;
}

/**
 * One to n boards turned over together, around the center of the whole group.
 * Only a group turns over: a board alone never does.
 */
export interface BoardGroup {
  name: string;
  boards: Board[];
  /** does the game allow this player to turn the group over */
  flippable: boolean;
  /** turned over locally by this player: drawn at 180° around its center */
  flipped: boolean;
  /** released tokens snap to the grids of its boards only when true */
  magnetism: boolean;
}

/** A rectangle in world coordinates. */
export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function createBoard(item: BoardItem): Board {
  const image = new Image();
  image.src = item.src;
  return {
    name: item.id,
    image,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    grid: readHexGrid(item.grid),
    group: null,
  };
}

// The boards of a group are ordinary boards, linked back to their group.
export function createBoardGroup(item: BoardGroupItem): BoardGroup {
  const group: BoardGroup = {
    name: item.id,
    boards: [],
    flippable: item.flippable ?? false,
    flipped: false,
    magnetism: item.magnetism === true,
  };
  group.boards = (item.boards ?? [])
    .filter((boardItem) => boardItem.kind === "board")
    .map((boardItem) => ({ ...createBoard(boardItem), group }));
  return group;
}

// The group a board is turned over with, or null when it is shown as is.
export function flippedGroup(board: Board): BoardGroup | null {
  return board.group !== null && board.group.flipped ? board.group : null;
}

// The area a flip turns around its center: the bounding box of the whole group.
// A half-turn maps this area onto itself, so a point inside it stays inside it.
export function flipArea(group: BoardGroup): Area {
  const left = Math.min(...group.boards.map((board) => board.x));
  const top = Math.min(...group.boards.map((board) => board.y));
  const right = Math.max(...group.boards.map((board) => board.x + boardDims(board).width));
  const bottom = Math.max(...group.boards.map((board) => board.y + boardDims(board).height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function boardDims(board: Board): { width: number; height: number } {
  const width = board.width;
  let height = board.height;

  const { image } = board;
  if (image.complete && image.naturalWidth) {
    height = Math.round((width * image.naturalHeight) / image.naturalWidth);
  }

  return { width, height };
}

export function allBoardsLoaded(boards: Board[]): boolean {
  return boards.every((board) => board.image.complete);
}
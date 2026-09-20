import type { BoardItem } from "../types";

export interface Board {
  image: HTMLImageElement;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function createBoard(item: BoardItem): Board {
  const image = new Image();
  image.src = item.src;
  return {
    image,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
  };
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
import type { BoardItem } from "../types";

export interface Board {
  /** id du plateau dans le game_json : le setup s'en sert pour le deplacer */
  name: string;
  image: HTMLImageElement;
  x: number;
  y: number;
  width: number;
  height: number;
  /** le jeu autorise-t-il le retournement local de ce plateau */
  flippable: boolean;
  /** retourné localement par ce joueur : dessiné à 180° autour de son centre */
  flipped: boolean;
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
    flippable: item.flippable ?? false,
    flipped: false,
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
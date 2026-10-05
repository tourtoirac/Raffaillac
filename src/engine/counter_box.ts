import type { CounterItem } from "../types";

/** part de la largeur et de la hauteur d'un compteur qu'occupent les zones + et - */
export const COUNTER_ZONE_RATIO = 0.28;

// Un compteur est un rectangle vide, pas une image : c'est le serveur qui
// renvoie une couleur de fond, une couleur de texte et une valeur, et le client
// qui dessine les trois. Rien à charger, donc aucune image à attendre avant
// d'afficher le compteur.
// couleur des signes + et - : toujours noir, pour se lire sur un fond clair
// comme sur un fond sombre.
const ZONE_TEXT_COLOR = "black";
// signe gris : la valeur a atteint sa borne, le bouton est mort. Le gris reste
// visible sur le pave du compteur, contrairement a une couleur transparente.
const ZONE_DISABLED_COLOR = "gray";
// part du rectangle que le chiffre peut occuper. La largeur laisse une marge de
// chaque cote, pour que le texte ne colle pas au bord ; la hauteur laisse de la
// place au-dessus et au-dessous du chiffre.
const VALUE_WIDTH_RATIO = 0.9;
const VALUE_HEIGHT_RATIO = 0.75;
// en dessous de cette taille un chiffre n'est plus lisible : on preferera qu'il
// deborde un peu plutot que de le rendre illisible
const MIN_FONT_SIZE = 6;

export type CounterAction = "increment" | "decrement";

export interface CounterBox {
  readonly name: string;
  // le setup du jeu peut deplacer un compteur : sa position n'est donc figee
  x: number;
  y: number;
  readonly width: number;
  readonly height: number;
  readonly color: string;
  /** couleur du chiffre ; le serveur garantit qu'elle se voit sur le fond */
  readonly fontColor: string;
  /** la valeur affichée, telle que le serveur l'a renvoyée */
  value: number;
  /** borne basse ; null quand le jeu laisse la valeur descendre sans fin */
  readonly min: number | null;
  /** borne haute ; null quand le jeu laisse la valeur monter sans fin */
  readonly max: number | null;
}

export function createCounterBox(item: CounterItem): CounterBox {
  return {
    name: item.id,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    color: item.color,
    // le serveur envoie toujours une font_color, deja choisie pour se voir sur le
    // fond. Le repli ci-dessous ne sert que si une session plus ancienne, ou un
    // test, n'envoie rien : mieux vaut alors le fond qu'un texte absent.
    fontColor: item.font_color ?? item.color,
    value: item.value ?? 0,
    // une borne absente vaut "aucune borne", comme sur le serveur : 0 est une
    // borne, pas une absence de borne
    min: item.min ?? null,
    max: item.max ?? null,
  };
}

/** Le + est-il encore possible ? */
export function canIncrement(box: CounterBox): boolean {
  return box.max === null || box.value < box.max;
}

/** Le - est-il encore possible ? */
export function canDecrement(box: CounterBox): boolean {
  return box.min === null || box.value > box.min;
}

/** Le signe de cette action est-il disponible ? */
export function isActionEnabled(box: CounterBox, action: CounterAction): boolean {
  return action === "increment" ? canIncrement(box) : canDecrement(box);
}

/**
 * La taille de police qui fait tenir le texte dans le rectangle, en largeur comme en
 * hauteur. La police est a chasse fixe : la largeur du texte est donc exactement
 * proportionnelle a la taille, ce qui evite de boucler au pixel pres. On part
 * de la taille qui remplit la hauteur, on mesure, puis on retrecit d'un coup si
 * le texte deborde en largeur. En dessous de MIN_FONT_SIZE on s'arrete : un
 * compteur minuscule affiche alors un texte qui deborde plutot qu'illisible.
 */
export function fitFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
  height: number,
): number {
  const maxWidth = width * VALUE_WIDTH_RATIO;
  const size = Math.max(MIN_FONT_SIZE, Math.floor(height * VALUE_HEIGHT_RATIO));

  ctx.font = `bold ${size}px monospace`;
  const measured = ctx.measureText(text).width;
  // une police jamais mesuree (un canvas qui ne sait pas mesurer) renvoie 0 :
  // dans ce cas on garde la taille pleine plutot que de la réduire à zero
  if (measured <= 0) return size;

  if (measured > maxWidth) {
    return Math.max(MIN_FONT_SIZE, Math.floor(size * (maxWidth / measured)));
  }
  return size;
}

/**
 * Dessine le fond du compteur et sa valeur, au centre. Les deux zones + et -
 * sont dessinées à part, par drawCounterActionZones, et seulement quand le
 * pointeur est sur le compteur : même principe que les zones de rotation d'un
 * pion.
 */
export function drawCounterBox(ctx: CanvasRenderingContext2D, box: CounterBox): void {
  // color est la couleur du fond du composant, pas celle d'un contour : le
  // compteur est un pave plein, sur lequel le chiffre vient se poser
  ctx.fillStyle = box.color;
  ctx.fillRect(box.x, box.y, box.width, box.height);

  // la valeur est centree dans le rectangle, et sa police retrécit pour que le
  // texte tienne toujours, meme quand la valeur gagne un chiffre
  const text = String(box.value);
  const size = fitFontSize(ctx, text, box.width, box.height);
  ctx.fillStyle = box.fontColor;
  ctx.font = `bold ${size}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, box.x + box.width / 2, box.y + box.height / 2);
  // le compteur ne doit pas laisser la police derriere lui pour le suivant
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

/**
 * Les deux signes + et -, aux deux bouts du rectangle. Aucun fond de zone : le signe
 * noir suffit a montrer la zone, et le compteur reste lisible sur n'importe quel
 * plateau, clair ou sombre. Un signe devenu impossible, parce que la valeur a
 * atteint min ou max, est grise : il reste visible pour que le joueur voie ou
 * le compteur s'arrete, mais il ne reagit plus.
 */
export function drawCounterActionZones(ctx: CanvasRenderingContext2D, box: CounterBox): void {
  const zoneWidth = box.width * COUNTER_ZONE_RATIO;
  const zoneHeight = box.height * COUNTER_ZONE_RATIO;
  const top = box.y + box.height / 2 - zoneHeight / 2;

  const zones: [CounterAction, number][] = [
    ["decrement", box.x],
    ["increment", box.x + box.width - zoneWidth],
  ];

  for (const [action, zoneX] of zones) {
    const enabled = isActionEnabled(box, action);
    ctx.fillStyle = enabled ? ZONE_TEXT_COLOR : ZONE_DISABLED_COLOR;
    ctx.font = `bold ${Math.round(zoneHeight)}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      action === "decrement" ? "-" : "+",
      zoneX + zoneWidth / 2,
      top + zoneHeight / 2,
    );
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }
}

/**
 * La zone + ou - sous le pointeur, ou null. Les bandes sont aux deux bouts du
 * rectangle, le milieu ne fait rien : cliquer le chiffre ne change pas la valeur.
 * Un signe grise n'est renvoye que si le pointeur le vise vraiment : c'est le
 * hit-test qui refuse l'action, on ne veut pas qu'un clic a cote ne soit
 * traite comme un clic dans le vide.
 */
export function counterActionZoneAt(box: CounterBox, wx: number, wy: number): CounterAction | null {
  const inside =
    wx >= box.x && wx <= box.x + box.width && wy >= box.y && wy <= box.y + box.height;
  if (!inside) return null;

  const zoneWidth = box.width * COUNTER_ZONE_RATIO;
  const zoneHeight = box.height * COUNTER_ZONE_RATIO;
  const top = box.y + box.height / 2 - zoneHeight / 2;
  // la zone ne couvre que la bande verticale des signes, pas toute la hauteur :
  // cliquer au-dessus du rectangle ne doit rien declencher
  if (wy < top || wy > top + zoneHeight) return null;

  if (wx < box.x + zoneWidth) return "decrement";
  if (wx >= box.x + box.width - zoneWidth) return "increment";
  return null;
}

/** Le compteur sous le pointeur, ou null. */
export function hitCounterBox(boxes: CounterBox[], wx: number, wy: number): CounterBox | null {
  // à l'envers comme pour les pions : le dernier dessiné est au-dessus
  for (let i = boxes.length - 1; i >= 0; i -= 1) {
    const box = boxes[i];
    const inside =
      wx >= box.x && wx <= box.x + box.width && wy >= box.y && wy <= box.y + box.height;
    if (inside) return box;
  }
  return null;
}
/**
 * Un dé : une image par face, positionnée dans la table comme un pion mais
 * ni déplaçable ni prenable. Un clic lance le dé, et le serveur diffuse la
 * face tirée à toute la session.
 *
 * Le délai entre deux lancés vient du jeu (roll_delay dans le game_json) ; le
 * serveur le confirme à chaque lancer. Le client s'en sert dès le premier clic
 * pour verrouiller le dé tout de suite, sans attendre la réponse.
 */
// A throw is animated: the dice shows a few random faces in a row before it
// settles on the face the server drew. The animation lasts a random time
// between these two bounds, and shows a new face every ROLL_FACE_INTERVAL_MS:
// 6 to 12 faces, quick enough to read as a tumbling dice, slow enough for
// each face to be seen.
const ROLL_ANIMATION_MIN_MS = 500;
const ROLL_ANIMATION_MAX_MS = 1000;
const ROLL_FACE_INTERVAL_MS = 80;

export class Dice {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** toutes les faces, préchargées : changer de face ne clignote pas */
  readonly faces: Map<string, HTMLImageElement>;
  /** délai annoncé par le serveur, en secondes */
  readonly rollDelay: number;

  x: number;
  y: number;
  /** face courante, chemin d'image */
  src: string;
  /** instant avant lequel un clic est ignoré, 0 si le dé est jouable */
  lockedUntil = 0;
  /** faces shown one after the other while the throw is animated */
  private rollFaces: string[] = [];
  /** when the running animation started, in ms */
  private rollStartedAt = 0;

  constructor(
    name: string,
    x: number,
    y: number,
    width: number,
    height: number,
    srcList: string[],
    src: string,
    rollDelay = 5,
  ) {
    this.name = name;
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.rollDelay = rollDelay;

    this.faces = new Map();
    for (const face of srcList) {
      const image = new Image();
      image.src = face;
      this.faces.set(face, image);
    }

    // face de repli si le serveur envoie un src absent de la liste
    this.src = this.faces.has(src) ? src : (srcList[0] ?? "");
  }

  /**
   * image of the face to draw, or null as long as it is not loaded: a random
   * face while a throw is animated, then the current face
   */
  face(): HTMLImageElement | null {
    const step = Math.floor((Date.now() - this.rollStartedAt) / ROLL_FACE_INTERVAL_MS);
    const src = step >= 0 && step < this.rollFaces.length ? this.rollFaces[step] : this.src;
    return this.faces.get(src) ?? null;
  }

  /**
   * Sets the face a throw drew, after an animation showing random faces. Only
   * the final face comes from the server: the faces shown on the way and the
   * length of the animation are picked here, and differ from screen to screen.
   */
  roll(src: string): void {
    if (!this.faces.has(src)) return;
    this.src = src;
    const sides = [...this.faces.keys()];
    this.rollFaces = [];
    // a dice with a single face has nothing to tumble through
    if (sides.length < 2) return;
    const duration =
      ROLL_ANIMATION_MIN_MS + Math.random() * (ROLL_ANIMATION_MAX_MS - ROLL_ANIMATION_MIN_MS);
    const steps = Math.round(duration / ROLL_FACE_INTERVAL_MS);
    // each face differs from the one that follows it, the final face included:
    // built backwards from it, so that every step is seen to change
    let next = src;
    for (let i = 0; i < steps; i++) {
      const others = sides.filter((side) => side !== next);
      next = others[Math.floor(Math.random() * others.length)];
      this.rollFaces.unshift(next);
    }
    this.rollStartedAt = Date.now();
  }

  /** rend le dé injouable pour la durée indiquée, en secondes */
  lockFor(seconds: number): void {
    this.lockedUntil = Date.now() + seconds * 1000;
  }

  isLocked(): boolean {
    return Date.now() < this.lockedUntil;
  }

  contains(x: number, y: number): boolean {
    return (
      this.x <= x &&
      x <= this.x + this.width &&
      this.y <= y &&
      y <= this.y + this.height
    );
  }
}

/**
 * One to n dice thrown together by one button. The pool draws nothing of its
 * own: its dice are ordinary dice, also listed with the others.
 */
export interface DicePool {
  readonly name: string;
  readonly dice: Dice[];
}

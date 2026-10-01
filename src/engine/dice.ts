/**
 * Un dé : une image par face, positionnée dans la table comme un pion mais
 * ni déplaçable ni prenable. Un clic lance le dé, et le serveur diffuse la
 * face tirée à toute la session.
 *
 * Le délai entre deux lancés vient du jeu (roll_delay dans le game_json) ; le
 * serveur le confirme à chaque lancer. Le client s'en sert dès le premier clic
 * pour verrouiller le dé tout de suite, sans attendre la réponse.
 */
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

  /** image de la face courante, ou null tant qu'elle n'est pas chargée */
  face(): HTMLImageElement | null {
    return this.faces.get(this.src) ?? null;
  }

  /** change de face, sans effet si l'image n'a pas été annoncée */
  setFace(src: string): void {
    if (this.faces.has(src)) this.src = src;
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

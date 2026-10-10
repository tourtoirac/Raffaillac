/** part de la largeur et de la hauteur du pion que occupe chaque zone */
export const ROTATION_ZONE_RATIO = 0.2;

// Ombre portée sous un pion : décalée vers le bas à droite, elle donne au
// compteur son épaisseur. Les valeurs sont en pixels du monde, comme la taille
// d'un pion : l'ombre grandit avec lui quand on zoome.
const SHADOW_COLOR = "rgba(0, 0, 0, 0.55)";
const SHADOW_BLUR = 4;
const SHADOW_OFFSET = 5;

// Opacité du pion fantôme posé sur la case de départ d'un pion "transparent".
// Assez pâle pour se distinguer du pion réel, assez visible pour servir de cible.
const ORIGIN_GHOST_ALPHA = 0.5;

export type RotationDirection = "left" | "right";

export type CounterSide = "front" | "back";

export class Counter {
  readonly name: string;
  /** image de la face avant */
  readonly frontImage: HTMLImageElement;
  /**
   * image de la face arrière, absente sur un pion qui ne se retourne pas.
   * Les deux images sont chargées d'emblée : retourner un pion ne doit pas
   * faire clignoter une image pas encore téléchargée.
   */
  readonly backImage: HTMLImageElement | null;
  readonly width: number;
  readonly height: number;
  /** le jeu autorise-t-il à repositionner ce pion, rectangle vert compris */
  readonly moveBorder: boolean;
  /** border du jeu : ce pion porte-t-il une ombre ? */
  readonly shadow: boolean;
  /**
   * "transparent" quand le jeu demande d'afficher le pion en transparence sur
   * sa case d'origine ; null sur un pion ordinaire
   */
  readonly origin: string | null;

  x: number;
  y: number;
  /**
   * case de départ, où revient un pion déposé sur son fantôme ; null for a
   * token that came out of a bag and has no starting square yet
   */
  initialX: number | null;
  initialY: number | null;
  /**
   * où est posé le fantôme, figé à l'installation du jeu. Le setup et "Fixe la
   * position" déplacent initialX, pas ceci : le fantôme est le repère que le
   * jeu a posé sur son plateau, il ne bouge pas avec la partie. null quand le
   * jeu ne demande aucun fantôme.
   */
  readonly originX: number | null;
  readonly originY: number | null;
  /** in_place : rectangle vert, le pion est-il sur sa case de départ ? */
  inPlace: boolean;
  held: boolean;
  heldBy: string | null;
  /** le jeu autorise-t-il à faire pivoter ce pion */
  orientable: boolean;
  /** angle courant, en degrés vers la droite */
  orientation: number;
  /** face affichée : le serveur en est seul juge */
  side: CounterSide;

  constructor(
    name: string,
    frontImage: HTMLImageElement,
    x: number,
    y: number,
    width = 40,
    height = 40,
    moveBorder = true,
    shadow = false,
    orientable = false,
    orientation = 0,
    backImage: HTMLImageElement | null = null,
    side: CounterSide = "front",
    origin: string | null = null,
    initialX: number | null = x,
    initialY: number | null = y,
    originX: number | null = null,
    originY: number | null = null,
  ) {
    this.name = name;
    this.frontImage = frontImage;
    this.backImage = backImage;
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.moveBorder = moveBorder;
    // border du jeu : une ombre, et rien d'autre. Elle ne bouge pas avec le
    // pion, contrairement au rectangle vert, qui part dès qu'il bouge.
    this.shadow = shadow;
    this.origin = origin;
    this.initialX = initialX;
    this.initialY = initialY;
    // le fantome reprend la place que le jeu a donnee au pion a son
    // installation. C'est initialX/initialY qui bougent ensuite, jamais lui.
    this.originX = origin === "transparent" ? (originX ?? x) : null;
    this.originY = origin === "transparent" ? (originY ?? y) : null;
    this.inPlace = moveBorder;
    this.held = false;
    this.heldBy = null;
    this.orientable = orientable;
    this.orientation = orientation;
    // un pion sans dos n'a qu'une face : le serveur ne peut pas le renvoyer
    // sur la face arrière, et une session reprise commence sur la face avant
    this.side = side === "back" && backImage !== null ? "back" : "front";
  }

  /** l'image de la face affichée, celle que le dessin utilise */
  get image(): HTMLImageElement {
    return this.side === "back" && this.backImage !== null ? this.backImage : this.frontImage;
  }

  /** ce pion a-t-il une seconde face ? */
  get flippable(): boolean {
    return this.backImage !== null;
  }

  /** le jeu demande-t-il un pion fantôme sur sa case d'origine ? */
  get showsOriginGhost(): boolean {
    return this.origin === "transparent" && this.originX !== null && this.originY !== null;
  }

  /**
   * Affiche la face que le serveur vient de désigner. Une face arrière sans
   * image reste la face avant : le client ne montre jamais une image absente.
   */
  setSide(side: CounterSide): void {
    this.side = side === "back" && this.backImage !== null ? "back" : "front";
  }

  /** le centre du pion, point autour duquel il tourne */
  private get centerX(): number {
    return this.x + this.width / 2;
  }

  private get centerY(): number {
    return this.y + this.height / 2;
  }

  /**
   * La zone de rotation visée par (wx, wy) : en haut à gauche pour tourner à
   * gauche, en haut à droite pour tourner à droite.
   *
   * Les zones restent à l'horizontale, ancrées au rectangle du pion, sans
   * suivre l'image tournée : c'est le pion qui est oblique, pas ses coins de
   * préhension, et des repères qui bougeraient avec lui seraientophyte à
   * viser sur un pion de travers.
   * @return la direction, ou null si le point n'est dans aucune zone
   */
  rotationZoneAt(wx: number, wy: number): RotationDirection | null {
    if (!this.orientable) return null;

    const inside =
      wx >= this.x &&
      wx <= this.x + this.width &&
      wy >= this.y &&
      wy <= this.y + this.height;
    if (!inside) return null;

    const zoneWidth = this.width * ROTATION_ZONE_RATIO;
    const zoneHeight = this.height * ROTATION_ZONE_RATIO;
    // bandes [bord, bord + zone) : le pixel qui déborde appartient au pion, pas
    // à la zone
    if (wy >= this.y + zoneHeight) return null;

    if (wx < this.x + zoneWidth) return "left";
    if (wx >= this.x + this.width - zoneWidth) return "right";
    return null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    // inutile de faire tourner une image droite, et ctx.save/restore coûte
    if (this.orientation % 360 === 0) {
      this.drawUpright(ctx);
      return;
    }

    ctx.save();
    ctx.translate(this.centerX, this.centerY);
    ctx.rotate((this.orientation * Math.PI) / 180);
    ctx.translate(-this.centerX, -this.centerY);
    this.drawUpright(ctx);
    ctx.restore();
  }

  /**
   * Le clic vise-t-il le fantôme de la case d'origine ? Le fantôme n'a pas de
   * zone de préhension : il sert juste de cible pour recentrer la caméra.
   */
  originGhostContains(x: number, y: number): boolean {
    const originX = this.originX;
    const originY = this.originY;
    if (!this.showsOriginGhost || originX === null || originY === null) return false;
    return (
      originX <= x &&
      x <= originX + this.width &&
      originY <= y &&
      y <= originY + this.height
    );
  }

  /**
   * Le pion en transparence, posé sur sa case d'origine. Dessiné sous les
   * pions, il ne capte pas la souris : c'est un repère, pas un objet.
   */
  drawOriginGhost(ctx: CanvasRenderingContext2D): void {
    const originX = this.originX;
    const originY = this.originY;
    if (!this.showsOriginGhost || originX === null || originY === null) return;
    if (!this.frontImage.complete) return;

    ctx.save();
    ctx.globalAlpha = ORIGIN_GHOST_ALPHA;
    ctx.drawImage(this.frontImage, originX, originY, this.width, this.height);
    ctx.restore();
  }

  private drawUpright(ctx: CanvasRenderingContext2D): void {
    // L'ombre portée passe par le dessin lui-même : le contexte la peint
    // derrière l'image, ce qui évite un second dessin de la même image. Elle ne
    // dépend que de border : elle rend le pion plus réaliste et suit le jeu
    // toute la partie, déplacé ou non.
    const castsShadow = this.shadow;
    if (castsShadow) {
      ctx.shadowColor = SHADOW_COLOR;
      ctx.shadowBlur = SHADOW_BLUR;
      ctx.shadowOffsetX = SHADOW_OFFSET;
      ctx.shadowOffsetY = SHADOW_OFFSET;
    }

    ctx.drawImage(this.image, this.x, this.y, this.width, this.height);

    if (castsShadow) {
      ctx.shadowColor = "rgba(0, 0, 0, 0)";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }

    if (this.held) {
      ctx.lineWidth = 5;
      ctx.strokeStyle = "orange";
      ctx.strokeRect(this.x, this.y, this.width, this.height);
    }

    if (this.inPlace) {
      ctx.lineWidth = 5;
      ctx.strokeStyle = "green";
      ctx.strokeRect(this.x, this.y, this.width, this.height);
    }
  }

  /**
   * Les deux zones de rotation, dessinées bien à plat : elles marquent l'angle
   * de prise en main, pas l'orientation du pion. Le jeu.ts ne les appelle que
   * lorsque le pointeur est sur le pion et que la main est vide.
   */
  drawRotationZones(ctx: CanvasRenderingContext2D): void {
    if (!this.orientable) return;

    const zoneWidth = this.width * ROTATION_ZONE_RATIO;
    const zoneHeight = this.height * ROTATION_ZONE_RATIO;
    const zones: [RotationDirection, number][] = [
      ["left", this.x],
      ["right", this.x + this.width - zoneWidth],
    ];

    for (const [direction, zoneX] of zones) {
      ctx.fillStyle = direction === "left" ? "rgba(80, 140, 255, 0.55)" : "rgba(255, 160, 60, 0.55)";
      ctx.fillRect(zoneX, this.y, zoneWidth, zoneHeight);

      // une flèche indique le sens du cran, pour ne pas avoir à le deviner
      ctx.strokeStyle = "white";
      ctx.lineWidth = 3;
      const centerY = this.y + zoneHeight / 2;
      // la pointe est du côté vers lequel le pion tourne
      const tipX = direction === "left" ? zoneX + zoneWidth * 0.3 : zoneX + zoneWidth * 0.7;
      const tailX = direction === "left" ? zoneX + zoneWidth * 0.72 : zoneX + zoneWidth * 0.28;
      ctx.beginPath();
      ctx.moveTo(tipX, centerY);
      ctx.lineTo(tailX, centerY - zoneHeight * 0.22);
      ctx.moveTo(tipX, centerY);
      ctx.lineTo(tailX, centerY + zoneHeight * 0.22);
      ctx.stroke();
    }
  }

  contains(x: number, y: number): boolean {
    // reste le rectangle englobant, comme avant : attraper un pion qui a tourné
    // doit se comporter comme attraper un pion droit
    return (
      this.x <= x &&
      x <= this.x + this.width &&
      this.y <= y &&
      y <= this.y + this.height
    );
  }
}

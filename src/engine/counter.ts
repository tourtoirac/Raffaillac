/** part de la largeur et de la hauteur du pion que occupe chaque zone */
export const ROTATION_ZONE_RATIO = 0.2;

export type RotationDirection = "left" | "right";

export class Counter {
  readonly name: string;
  readonly image: HTMLImageElement;
  readonly width: number;
  readonly height: number;
  readonly moveBorder: boolean;
  readonly shadow: boolean;

  x: number;
  y: number;
  /** rectangle vert : piloté par le serveur, valable pour tous */
  border: boolean;
  held: boolean;
  heldBy: string | null;
  /** le jeu autorise-t-il à faire pivoter ce pion */
  orientable: boolean;
  /** angle courant, en degrés vers la droite */
  orientation: number;

  constructor(
    name: string,
    image: HTMLImageElement,
    x: number,
    y: number,
    width = 40,
    height = 40,
    moveBorder = true,
    shadow = false,
    orientable = false,
    orientation = 0,
  ) {
    this.name = name;
    this.image = image;
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.moveBorder = moveBorder;
    this.shadow = shadow;
    this.border = moveBorder;
    this.held = false;
    this.heldBy = null;
    this.orientable = orientable;
    this.orientation = orientation;
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

  private drawUpright(ctx: CanvasRenderingContext2D): void {
    ctx.drawImage(this.image, this.x, this.y, this.width, this.height);

    if (this.held) {
      ctx.lineWidth = 5;
      ctx.strokeStyle = "orange";
      ctx.strokeRect(this.x, this.y, this.width, this.height);
    }

    if (this.border) {
      ctx.lineWidth = 5;
      ctx.strokeStyle = "green";
      ctx.strokeRect(this.x, this.y, this.width, this.height);
    } else if (this.shadow) {
      ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
      ctx.shadowBlur = 3;
      ctx.shadowOffsetX = 3;
      ctx.shadowOffsetY = 3;

      ctx.drawImage(this.image, this.x, this.y, this.width, this.height);

      ctx.shadowColor = "rgba(0, 0, 0, 0)";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
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

const MOVE_THRESHOLD = 30;

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
  /** emplacement initial du jeu : y revenir rend le rectangle vert */
  initialX: number;
  initialY: number;

  constructor(
    name: string,
    image: HTMLImageElement,
    x: number,
    y: number,
    width = 40,
    height = 40,
    moveBorder = true,
    shadow = false,
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
    this.initialX = x;
    this.initialY = y;
  }

  draw(ctx: CanvasRenderingContext2D): void {
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

  contains(x: number, y: number): boolean {
    return (
      this.x <= x &&
      x <= this.x + this.width &&
      this.y <= y &&
      y <= this.y + this.height
    );
  }

  hasMoved(): boolean {
    const dx = this.x - this.initialX;
    const dy = this.y - this.initialY;
    return dx * dx + dy * dy > MOVE_THRESHOLD * MOVE_THRESHOLD;
  }
}
export class Button {
  constructor(
    public readonly x: number,
    public readonly y: number,
    public readonly w: number,
    public readonly h: number,
    public readonly text: string,
    public readonly callback: () => void,
  ) {}

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "#3a7";
    ctx.fillRect(this.x, this.y, this.w, this.h);

    ctx.strokeStyle = "black";
    ctx.strokeRect(this.x, this.y, this.w, this.h);

    ctx.fillStyle = "white";
    ctx.font = "20px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillText(this.text, this.x + this.w / 2, this.y + this.h / 2);
  }

  contains(x: number, y: number): boolean {
    return (
      this.x <= x && x <= this.x + this.w && this.y <= y && y <= this.y + this.h
    );
  }
}
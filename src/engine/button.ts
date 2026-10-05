export class Button {
  constructor(
    // x et y sont mutables : un bouton ancré sur un plateau est reposé à chaque
    // image, le plateau se déplaçant sous lui quand la caméra bouge
    public x: number,
    public y: number,
    public readonly w: number,
    public readonly h: number,
    public readonly text: string,
    public readonly callback: () => void,
  ) {}

  draw(ctx: CanvasRenderingContext2D): void {
    // alignement et police sont des reglages du contexte, pas de l'image : on les
    // rend apres coup. Sans cela, un bouton dessine avant un texte le.decale de
    // son point d'ancrage - le bandeau d'info s'afficherait alors centre au
    // lieu de partir de son coin gauche.
    ctx.save();

    ctx.fillStyle = "#3a7";
    ctx.fillRect(this.x, this.y, this.w, this.h);

    ctx.strokeStyle = "black";
    ctx.strokeRect(this.x, this.y, this.w, this.h);

    ctx.fillStyle = "white";
    ctx.font = "20px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillText(this.text, this.x + this.w / 2, this.y + this.h / 2);

    ctx.restore();
  }

  contains(x: number, y: number): boolean {
    return (
      this.x <= x && x <= this.x + this.w && this.y <= y && y <= this.y + this.h
    );
  }
}
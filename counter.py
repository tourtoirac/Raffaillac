from js import Image

class Counter:

    SIZE = 40


    def __init__(self, name, image, x, y):

        self.name = name
        self.image = image
        self.border = True

        self.x = x
        self.y = y

        self.start_turn_x = x
        self.start_turn_y = y

    def start_turn_reset(self):
        self.start_turn_x = self.x
        self.start_turn_y = self.y
        self.border = True

    def draw(self, ctx):

        ctx.drawImage(
            self.image,
            self.x,
            self.y,
            self.SIZE,
            self.SIZE
        )
        if self.border:

            ctx.lineWidth = 5
            ctx.strokeStyle = "green"

            ctx.strokeRect(
                self.x,
                self.y,
                self.SIZE,
                self.SIZE
            )

    def contains(self, x, y):

        return (
            self.x <= x <= self.x + self.SIZE
            and
            self.y <= y <= self.y + self.SIZE
        )

    def has_moved(self):
        print("test move")

        dx = self.x - self.start_turn_x
        dy = self.y - self.start_turn_y

        return (
            dx * dx + dy * dy
        ) > (30 * 30)


def create_counter(counter, loaded_images, counters):

    img = Image.new()
    img.src = counter["file"]

    loaded_images.append(img)

    counters.append(
        Counter(
            counter['name'],
            img,
            counter['x'],
            counter['y']
        )
    )

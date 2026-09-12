import json

from js import Image, document, window
from pyodide.ffi import create_proxy

loaded_images = []

counters = []

# ------------------------
# Caméra (comme Vietnam)
# ------------------------

camera_x = 0
camera_y = 0
zoom = 1.0

MIN_ZOOM = 0.2
MAX_ZOOM = 3.0
ZOOM_FACTOR = 1.1

world_width = 0
world_height = 0
camera_initialized = False

CLICK_THRESHOLD = 5


class Counter:
    def __init__(self, name, image, x, y, width=40, height=40, move_border=True, shadow=False):
        self.name = name
        self.image = image
        self.move_border = move_border
        self.shadow = shadow
        self.border = move_border
        self.x = x
        self.y = y
        self.width = width
        self.height = height
        self.start_turn_x = x
        self.start_turn_y = y

    def start_turn_reset(self):
        self.start_turn_x = self.x
        self.start_turn_y = self.y
        self.border = self.move_border

    def draw(self, ctx):
        ctx.drawImage(
            self.image,
            self.x,
            self.y,
            self.width,
            self.height
        )

        # bordure verte uniquement si move_border est actif
        if self.border:
            ctx.lineWidth = 5
            ctx.strokeStyle = "green"
            ctx.strokeRect(
                self.x,
                self.y,
                self.width,
                self.height
            )
        # sinon, ombre portée de 3 pixels si shadow est actif
        elif self.shadow:
            ctx.shadowColor = "rgba(0, 0, 0, 0.7)"
            ctx.shadowBlur = 3
            ctx.shadowOffsetX = 3
            ctx.shadowOffsetY = 3

            ctx.drawImage(
                self.image,
                self.x,
                self.y,
                self.width,
                self.height
            )

            ctx.shadowColor = "rgba(0, 0, 0, 0)"
            ctx.shadowBlur = 0
            ctx.shadowOffsetX = 0
            ctx.shadowOffsetY = 0

    def contains(self, x, y):
        return (
            self.x <= x <= self.x + self.width
            and self.y <= y <= self.y + self.height
        )

    def has_moved(self):
        print("test move")
        dx = self.x - self.start_turn_x
        dy = self.y - self.start_turn_y

        return (dx * dx + dy * dy) > (30 * 30)


class Button:
    def __init__(self, x, y, w, h, text, callback):
        self.x = x
        self.y = y
        self.w = w
        self.h = h
        self.text = text
        self.callback = callback

    def draw(self, ctx):
        ctx.fillStyle = "#3a7"
        ctx.fillRect(self.x, self.y, self.w, self.h)

        ctx.strokeStyle = "black"
        ctx.strokeRect(self.x, self.y, self.w, self.h)

        ctx.fillStyle = "white"
        ctx.font = "20px Arial"
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"

        ctx.fillText(
            self.text,
            self.x + self.w / 2,
            self.y + self.h / 2
        )

    def contains(self, x, y):
        return (
            self.x <= x <= self.x + self.w
            and self.y <= y <= self.y + self.h
        )


def position_fix():
    for current_counter in counters:
        current_counter.start_turn_reset()


# ------------------------
# Canvas : taille du viewport
# ------------------------

canvas = document.getElementById("gameCanvas")
ctx = canvas.getContext("2d")

canvas.width = canvas.clientWidth
canvas.height = canvas.clientHeight

# ------------------------
# Lecture du json de session
# ------------------------

game_json = {}
session_key = None
try:
    raw_session = window.sessionStorage.getItem("obg_session")
    if raw_session:
        session_data = json.loads(raw_session)
        game_json = session_data.get("game_json", {})
        session_key = session_data.get("key")
except Exception as e:
    print("Impossible de lire la session :", e)

session_info = document.getElementById("session-info")
if session_key:
    session_info.textContent = f"Session {session_key}"
else:
    session_info.textContent = "Aucune session active"

# ------------------------
# Plateaux décrits par le json
# ------------------------

boards = []
for board in game_json.get("board", []):
    img = Image.new()
    img.src = board["src"]

    loaded_images.append(img)

    boards.append(
        {
            "image": img,
            "x": board["x"],
            "y": board["y"],
            "width": board["width"],
            "height": board["height"],
        }
    )


def board_dims(board):
    image = board["image"]
    width = board["width"]
    height = board["height"]

    # respect de l'aspect ratio de l'image source
    if image.complete and image.naturalWidth:
        height = int(width * image.naturalHeight / image.naturalWidth)

    return width, height


# ------------------------
# Pions décrits par le json
# ------------------------

def create_counter(token):
    img = Image.new()
    img.src = token["front_src"]

    loaded_images.append(img)

    counters.append(
        Counter(
            token["id"],
            img,
            token["x"],
            token["y"],
            token["width"],
            token["height"],
            token.get("move_border", True),
            token.get("shadow", False)
        )
    )


for token in game_json.get("token", []):
    create_counter(token)


button_fix = Button(
    1350,
    10,
    220,
    40,
    "Fixe la position",
    position_fix
)


# ------------------------
# Caméra : initialisation une fois les plateaux chargés
# ------------------------

def initialize_camera():
    global camera_initialized, zoom, world_width, world_height

    if camera_initialized:
        return

    for board in boards:
        if not board["image"].complete:
            return

    world_width = max(board["x"] + board_dims(board)[0] for board in boards)
    world_height = max(board["y"] + board_dims(board)[1] for board in boards)

    zoom = min(canvas.width / world_width, canvas.height / world_height) * 0.98
    zoom = max(MIN_ZOOM, min(MAX_ZOOM, zoom))

    camera_initialized = True


# ------------------------
# Souris
# ------------------------

last_mouse_x = 0
last_mouse_y = 0

panning = False
selected_counter = None
counter_info_text = ""


def counter_position_text(counter):
    return f"{counter.name}  x={int(counter.x)}  y={int(counter.y)}"


def screen_to_world(sx, sy):
    return camera_x + sx / zoom, camera_y + sy / zoom


def mouse_down(event):
    global panning, selected_counter
    global counter_info_text
    global last_mouse_x, last_mouse_y

    sx = event.offsetX
    sy = event.offsetY
    wx, wy = screen_to_world(sx, sy)

    if button_fix.contains(wx, wy):
        button_fix.callback()
        return

    # un pion est déjà ramassé : on le dépose (like Vietnam)
    if selected_counter is not None:
        drop_counter()
        return

    hit = None
    for counter in reversed(counters):
        if counter.contains(wx, wy):
            hit = counter
            break

    if hit is not None:
        selected_counter = hit
        counter_info_text = counter_position_text(hit)
    else:
        panning = True

    last_mouse_x = sx
    last_mouse_y = sy


def drop_counter():
    global selected_counter
    global counter_info_text

    if selected_counter is None:
        return

    # le snap-back / bascule de bordure n'a lieu que pour move_border=true
    if selected_counter.move_border:
        if selected_counter.has_moved():
            selected_counter.border = False
        else:
            selected_counter.border = True
            selected_counter.x = selected_counter.start_turn_x
            selected_counter.y = selected_counter.start_turn_y

    counter_info_text = counter_position_text(selected_counter)
    selected_counter = None


def mouse_move(event):
    global camera_x, camera_y
    global counter_info_text
    global last_mouse_x, last_mouse_y

    sx = event.offsetX
    sy = event.offsetY

    if panning:
        camera_x = camera_x - (sx - last_mouse_x) / zoom
        camera_y = camera_y - (sy - last_mouse_y) / zoom

        last_mouse_x = sx
        last_mouse_y = sy
        return

    if selected_counter is not None:
        wx, wy = screen_to_world(sx, sy)

        selected_counter.x = wx - selected_counter.width // 2
        selected_counter.y = wy - selected_counter.height // 2

        counter_info_text = counter_position_text(selected_counter)

    last_mouse_x = sx
    last_mouse_y = sy


def mouse_up(event):
    global panning

    panning = False


def mouse_leave(event):
    global panning

    panning = False


def mouse_wheel(event):
    global zoom, camera_x, camera_y

    event.preventDefault()

    mx = event.offsetX
    my = event.offsetY

    wx, wy = screen_to_world(mx, my)

    if event.deltaY < 0:
        zoom *= ZOOM_FACTOR
    else:
        zoom /= ZOOM_FACTOR

    zoom = max(MIN_ZOOM, min(MAX_ZOOM, zoom))

    camera_x = wx - mx / zoom
    camera_y = wy - my / zoom


# ------------------------
# Dessin
# ------------------------

def draw():
    initialize_camera()

    # fond gris sur tout l'écran
    ctx.fillStyle = "gray"
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    ctx.save()
    ctx.setTransform(
        zoom,
        0,
        0,
        zoom,
        -camera_x * zoom,
        -camera_y * zoom,
    )

    # plateaux décrits dans le json
    for board in boards:
        image = board["image"]

        if image.complete:
            width, height = board_dims(board)

            ctx.drawImage(
                image,
                board["x"],
                board["y"],
                width,
                height
            )

    button_fix.draw(ctx)

    # counters
    for counter in counters:
        counter.draw(ctx)

    ctx.restore()

    # barre d'info (écran) : nom + position du pion
    if counter_info_text:
        ctx.fillStyle = "black"
        ctx.fillRect(0, 0, canvas.width, 28)
        ctx.fillStyle = "white"
        ctx.font = "bold 16px monospace"
        ctx.fillText(counter_info_text, 10, 20)


# ------------------------
# Boucle du jeu
# ------------------------

def game_loop(timestamp=None):
    draw()
    window.requestAnimationFrame(game_loop_proxy)


game_loop_proxy = create_proxy(game_loop)
window.requestAnimationFrame(game_loop_proxy)

# ------------------------
# Événements
# ------------------------

mouse_down_proxy = create_proxy(mouse_down)
mouse_move_proxy = create_proxy(mouse_move)
mouse_up_proxy = create_proxy(mouse_up)
mouse_leave_proxy = create_proxy(mouse_leave)
mouse_wheel_proxy = create_proxy(mouse_wheel)

canvas.addEventListener("mousedown", mouse_down_proxy)
canvas.addEventListener("mousemove", mouse_move_proxy)
canvas.addEventListener("mouseup", mouse_up_proxy)
canvas.addEventListener("mouseleave", mouse_leave_proxy)
canvas.addEventListener("wheel", mouse_wheel_proxy)

# relâchement hors du canvas
window.addEventListener("mouseup", mouse_up_proxy)
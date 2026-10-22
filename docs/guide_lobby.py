"""
Builds the user guide of the lobby (public/guide_lobby.pdf).

Usage: python3 docs/guide_lobby.py [fpdf2_lib_dir] [output.pdf]
fpdf2 is not a dependency of the project: install it apart, for example with
`pip install --target <dir> fpdf2`, and give that directory as first argument.
The fonts are the Windows ones (Arial), reached from WSL.
"""
import os
import sys

if len(sys.argv) > 1:
    sys.path.insert(0, sys.argv[1])

from fpdf import FPDF  # noqa: E402
from fpdf.fonts import FontFace  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUTPUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "..", "public", "guide_lobby.pdf")
FONTS = "/mnt/c/Windows/Fonts"

# colours of index.html, so the diagram looks like the real page
BLUE = (0, 123, 255)
GREEN = (40, 167, 69)
LIGHT_GREEN = (232, 247, 236)
DARK_GREEN = (29, 122, 51)
LIGHT_BLUE = (231, 241, 255)
GREY = (224, 224, 224)
MID_GREY = (204, 204, 204)
TEXT = (51, 51, 51)
MUTED = (110, 110, 110)
PAGE_BG = (244, 244, 249)
MARK = (220, 53, 69)


class Guide(FPDF):
    def header(self):
        if self.page_no() == 1:
            return
        self.set_font("Arial", "", 8)
        self.set_text_color(*MUTED)
        self.cell(0, 6, "Online Boardgames — Guide du lobby", align="R")
        self.ln(10)

    def footer(self):
        self.set_y(-12)
        self.set_font("Arial", "", 8)
        self.set_text_color(*MUTED)
        self.cell(0, 6, f"{self.page_no()} / {{nb}}", align="C")

    # ---- text helpers ----

    def h1(self, text):
        self.set_font("Arial", "B", 16)
        self.set_text_color(*BLUE)
        self.ln(2)
        self.cell(0, 9, text, new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(*BLUE)
        self.set_line_width(0.5)
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.ln(3)

    def h2(self, text):
        self.set_font("Arial", "B", 12)
        self.set_text_color(*TEXT)
        self.ln(1)
        self.cell(0, 7, text, new_x="LMARGIN", new_y="NEXT")

    def para(self, text):
        self.set_font("Arial", "", 10.5)
        self.set_text_color(*TEXT)
        self.multi_cell(0, 5.4, text, markdown=True, new_x="LMARGIN", new_y="NEXT")
        self.ln(1.5)

    def bullets(self, items, indent=4):
        self.set_font("Arial", "", 10.5)
        self.set_text_color(*TEXT)
        for item in items:
            x = self.l_margin + indent
            self.set_x(x)
            self.cell(5, 5.4, "•")
            self.multi_cell(self.w - self.r_margin - x - 5, 5.4, item, markdown=True,
                            new_x="LMARGIN", new_y="NEXT")
            self.ln(0.8)
        self.ln(1)

    def note(self, text, colour=BLUE, fill=LIGHT_BLUE):
        self.set_font("Arial", "", 10)
        self.set_text_color(*TEXT)
        self.set_fill_color(*fill)
        self.set_draw_color(*colour)
        y = self.get_y()
        x = self.l_margin
        self.set_x(x + 4)
        self.multi_cell(self.w - self.l_margin - self.r_margin - 6, 5.2, text, markdown=True,
                        fill=True, padding=2.5, new_x="LMARGIN", new_y="NEXT")
        self.set_line_width(1.2)
        self.line(x + 2, y, x + 2, self.get_y())
        self.ln(3)

    def table(self, rows, widths):
        self.set_draw_color(*MID_GREY)
        self.set_line_width(0.2)
        self.set_font("Arial", "", 10)
        self.set_text_color(*TEXT)
        headings = FontFace(emphasis="BOLD", fill_color=(248, 249, 250))
        with super().table(col_widths=widths, line_height=5.2, text_align="LEFT",
                           headings_style=headings, markdown=True,
                           cell_fill_color=(255, 255, 255), cell_fill_mode="ALL") as t:
            for row in rows:
                r = t.row()
                for cell in row:
                    r.cell(cell)
        self.ln(3)

    # ---- diagram helpers ----

    def box(self, x, y, w, h, fill, border=None, radius=1.2):
        self.set_fill_color(*fill)
        self.set_draw_color(*(border or fill))
        self.set_line_width(0.3)
        self.rect(x, y, w, h, style="DF", round_corners=True, corner_radius=radius)

    def label(self, x, y, w, h, text, size=8, colour=TEXT, bold=False, align="C"):
        self.set_font("Arial", "B" if bold else "", size)
        self.set_text_color(*colour)
        self.set_xy(x, y)
        self.cell(w, h, text, align=align)

    def marker(self, x, y, n):
        self.set_fill_color(*MARK)
        self.set_draw_color(*MARK)
        self.circle(x, y, 2.6, style="F")
        self.set_font("Arial", "B", 8)
        self.set_text_color(255, 255, 255)
        self.set_xy(x - 2.6, y - 2.6)
        self.cell(5.2, 5.2, str(n), align="C")


def draw_lobby_diagram(pdf, top):
    """Simplified drawing of the lobby page, with numbered markers."""
    x0, w0 = pdf.l_margin, pdf.w - pdf.l_margin - pdf.r_margin
    h0 = 90
    pdf.box(x0, top, w0, h0, PAGE_BG, MID_GREY, radius=2)

    # title and help link
    pdf.label(x0 + 4, top + 3, 80, 8, "Online Boardgames", 13, TEXT, True, "L")
    pdf.label(x0 + w0 - 34, top + 3, 30, 8, "Aide (PDF)", 8.5, BLUE, False, "R")
    pdf.set_draw_color(*BLUE)
    pdf.line(x0 + w0 - 19, top + 9.2, x0 + w0 - 4, top + 9.2)
    pdf.marker(x0 + w0 - 38, top + 7, 1)

    # type tabs (the log of server messages is only shown on localhost: not drawn)
    ty = top + 16
    pdf.box(x0 + 4, ty, 28, 8, BLUE, BLUE)
    pdf.label(x0 + 4, ty, 28, 8, "Boardgame", 8, (255, 255, 255), True)
    pdf.box(x0 + 33, ty, 24, 8, GREY, MID_GREY)
    pdf.label(x0 + 33, ty, 24, 8, "Wargame", 8)
    pdf.box(x0 + 58, ty, 24, 8, GREY, MID_GREY)
    pdf.label(x0 + 58, ty, 24, 8, "Arbitrés", 8)
    pdf.set_draw_color(*BLUE)
    pdf.set_line_width(0.6)
    pdf.line(x0 + 4, ty + 8, x0 + w0 - 4, ty + 8)
    pdf.marker(x0 + 86, ty + 4, 2)

    # game tabs
    gy = top + 29
    for i, name in enumerate(["Carcassonne", "Catan", "Splendor"]):
        active = i == 0
        pdf.box(x0 + 4, gy + i * 10, 34, 8, (255, 255, 255) if active else GREY,
                BLUE if active else MID_GREY)
        pdf.label(x0 + 7, gy + i * 10, 30, 8, name, 8, BLUE if active else TEXT, active, "L")
    pdf.marker(x0 + 41, gy + 4, 3)

    # sessions table
    tx, tw = x0 + 46, w0 - 50
    pdf.box(tx, gy, tw, 56, (255, 255, 255), MID_GREY)
    cx = [tx + 4, tx + 26, tx + tw - 34, tx + tw - 4]
    hy = gy + 4
    pdf.set_draw_color(221, 221, 221)
    pdf.set_line_width(0.2)
    pdf.set_fill_color(248, 249, 250)
    pdf.rect(cx[0], hy, cx[3] - cx[0], 7, style="DF")
    for x, title in zip(cx, ["Code", "Joueurs", "Rejoindre"]):
        pdf.label(x + 2, hy, 30, 7, title, 8, TEXT, True, "L")

    # one row: a connected owner, a free seat, Join and Spectateur buttons
    ry = hy + 7
    pdf.set_draw_color(221, 221, 221)
    pdf.rect(cx[0], ry, cx[3] - cx[0], 22)
    pdf.line(cx[1], hy, cx[1], ry + 22)
    pdf.line(cx[2], hy, cx[2], ry + 22)
    pdf.label(cx[0] + 2, ry + 1, 20, 7, "K7Q2", 8, TEXT, False, "L")
    pdf.box(cx[1] + 2, ry + 2, 33, 7, LIGHT_GREEN, GREEN)
    pdf.label(cx[1] + 2, ry + 2, 33, 7, "Alice (owner)", 7.5, DARK_GREEN)
    pdf.box(cx[1] + 37, ry + 2, 20, 7, LIGHT_BLUE, BLUE)
    pdf.label(cx[1] + 37, ry + 2, 20, 7, "Bruno", 7.5, BLUE)
    pdf.marker(cx[1] + 36, ry + 14, 4)
    pdf.box(cx[2] + 2, ry + 2, 26, 7, LIGHT_GREEN, GREEN)
    pdf.label(cx[2] + 2, ry + 2, 26, 7, "Join", 7.5, DARK_GREEN)
    pdf.box(cx[2] + 2, ry + 11, 26, 7, (240, 240, 240), (187, 187, 187))
    pdf.label(cx[2] + 2, ry + 11, 26, 7, "Spectateur", 7.5, (102, 102, 102))
    pdf.marker(cx[2] - 3, ry + 9, 5)

    # create button
    by = ry + 27
    pdf.box(cx[0], by, 22, 8, GREEN, GREEN)
    pdf.label(cx[0], by, 22, 8, "Create ▾", 8, (255, 255, 255), True)
    pdf.marker(cx[0] + 26, by + 4, 6)

    pdf.set_y(top + h0 + 3)


def build():
    pdf = Guide(format="A4")
    pdf.add_font("Arial", "", f"{FONTS}/arial.ttf")
    pdf.add_font("Arial", "B", f"{FONTS}/arialbd.ttf")
    pdf.add_font("Arial", "I", f"{FONTS}/ariali.ttf")
    pdf.add_font("Arial", "BI", f"{FONTS}/arialbi.ttf")
    # Arial has no "▾" (the arrow of the Create button)
    pdf.add_font("Symbols", "", f"{FONTS}/seguisym.ttf")
    pdf.set_fallback_fonts(["Symbols"], exact_match=False)
    pdf.set_margins(18, 16, 18)
    pdf.set_auto_page_break(True, 18)
    pdf.set_title("Guide du lobby — Online Boardgames")
    pdf.set_author("Online Boardgames")

    # ---- page 1: overview ----
    pdf.add_page()
    pdf.set_font("Arial", "B", 22)
    pdf.set_text_color(*TEXT)
    pdf.cell(0, 12, "Guide du lobby", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Arial", "", 12)
    pdf.set_text_color(*MUTED)
    pdf.cell(0, 7, "Online Boardgames — trouver, créer et rejoindre une partie",
             new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)
    pdf.para(
        "Le lobby est la page d'accueil d'Online Boardgames. Il présente les jeux "
        "disponibles et, pour chacun, les parties en cours. On y crée une partie, on "
        "rejoint celle d'un autre joueur, on reprend sa place après une déconnexion, ou "
        "l'on regarde une partie en spectateur. Une fois la partie choisie, le lobby "
        "ouvre la table de jeu."
    )

    pdf.h1("Vue d'ensemble de l'écran")
    draw_lobby_diagram(pdf, pdf.get_y() + 1)
    pdf.table([
        ["", "Élément", "Rôle"],
        ["1", "Lien « Aide »", "Ouvre ce guide dans un nouvel onglet."],
        ["2", "Onglets de type de jeu", "Boardgame (jeux de plateau), Wargame (jeux de guerre) ou "
                                        "Arbitrés (jeux dont le serveur applique les règles)."],
        ["3", "Liste des jeux", "Les jeux du type choisi ; cliquer sur un jeu affiche ses parties."],
        ["4", "Joueurs d'une partie", "Un bouton par joueur assis : vert s'il est en jeu, bleu si sa place est libre."],
        ["5", "Rejoindre", "« Join » pour prendre un nouveau siège, « Spectateur » pour regarder."],
        ["6", "Create", "Crée une nouvelle partie du jeu affiché (menu si le jeu a plusieurs variantes)."],
    ], (8, 42, 124))

    # ---- choosing a game ----
    pdf.h1("Choisir un jeu")
    pdf.para(
        "Les jeux sont rangés en trois familles, accessibles par les onglets en haut de "
        "la page : **Boardgame**, **Wargame** et **Arbitrés**. La colonne de gauche liste "
        "les jeux de la famille affichée, par ordre alphabétique ; le jeu sélectionné est "
        "encadré en bleu."
    )
    pdf.bullets([
        "Le catalogue est fourni par le serveur : seuls les jeux activés par "
        "l'administrateur apparaissent. Si une famille n'en contient aucun, le lobby "
        "affiche « Aucun jeu disponible ».",
        "Le jeu et la famille choisis sont gardés dans l'adresse de la page "
        "(?game=…&type=…). Recharger la page ou revenir d'une partie ramène donc sur "
        "le même jeu, et l'adresse peut être partagée avec un ami.",
    ])

    pdf.h2("Les jeux arbitrés")
    pdf.para(
        "Sur la table de jeu ordinaire, ce sont les joueurs qui appliquent les règles : "
        "le site déplace les pièces et les cartes comme on le ferait autour d'une vraie "
        "table. Les jeux de l'onglet **Arbitrés** (aujourd'hui **Air Force** et **Judge "
        "Dredd**) se jouent au contraire sur une page qui leur est propre, où le serveur "
        "fait respecter les règles : il n'accepte que les coups permis, lance les dés et "
        "garde secret ce qui doit l'être."
    )
    pdf.bullets([
        "La liste, la création d'une partie, « Join », « Spectateur » et la reprise d'une "
        "place s'y utilisent comme pour les autres jeux. Air Force demande en plus le camp "
        "et l'avion, Judge Dredd la couleur du juge.",
        "Une partie de **Judge Dredd** accueille 2 à 6 joueurs ; elle commence quand son "
        "créateur clique sur « Lancer la partie », sur la page de jeu.",
        "Si le serveur d'un jeu arbitré ne répond pas, son onglet disparaît jusqu'à son retour.",
    ])

    # ---- the session table ----
    pdf.h1("Lire la liste des parties")
    pdf.para(
        "À droite, le tableau donne une ligne par partie active du jeu sélectionné. "
        "Sans partie en cours, il affiche « Aucune session active »."
    )
    pdf.table([
        ["Colonne", "Contenu"],
        ["Code", "Identifiant court de la partie, à communiquer aux autres joueurs pour qu'ils la retrouvent."],
        ["Joueurs", "Un bouton par joueur assis, avec sa nationalité entre parenthèses si le jeu en utilise. "
                    "La mention (owner) désigne le créateur de la partie."],
        ["Rejoindre", "Les boutons « Join » et « Spectateur », quand ils sont proposés."],
    ], (30, 144))
    pdf.h2("Couleur des boutons de joueur")
    pdf.bullets([
        "**Vert** : le joueur est actuellement à la table. Le bouton est inactif.",
        "**Bleu** : le joueur s'est déconnecté, sa place est libre. Un clic permet de "
        "reprendre ce siège (voir « Reprendre sa place »).",
    ])
    pdf.para(
        "La liste se met à jour toute seule : chaque arrivée ou départ d'un joueur, "
        "chaque nouvelle partie est reflétée sans recharger la page."
    )
    pdf.h2("Rechercher, feuilleter")
    pdf.bullets([
        "Le champ de **recherche** au-dessus des jeux filtre les parties par code ou par "
        "pseudo d'un joueur, quelle que soit la casse.",
        "Chaque jeu montre **10 parties par page** : les boutons « Précédent » et "
        "« Suivant » sous le tableau font défiler les autres.",
    ])

    # ---- creating a session ----
    pdf.h1("Créer une partie")
    pdf.para(
        "Cliquer sur **Create** sous le tableau. Si le jeu propose plusieurs variantes "
        "(scénarios, nombre de joueurs…), le bouton devient **Create ▾** et ouvre un menu "
        "où l'on choisit la variante. Une fenêtre demande alors :"
    )
    pdf.table([
        ["Champ", "Obligatoire", "Usage"],
        ["Nickname", "Oui", "Votre pseudo à la table."],
        ["Clé d'utilisateur", "Non", "Mot de passe personnel attaché à votre pseudo dans cette partie. "
                                     "Il vous sera redemandé pour reprendre votre place ; il empêche "
                                     "quelqu'un d'autre de s'asseoir sous votre nom."],
        ["Nationalité", "Si le jeu en a", "Le camp que vous jouez. Certains pions ne peuvent être "
                                          "manipulés que par le joueur de leur nationalité."],
        ["Joueurs minimum / maximum", "—", "Affichés seulement quand la variante accepte un nombre de "
                                          "joueurs variable ; pré-remplis avec les bornes du jeu."],
        ["Clé d'accès au jeu", "Non", "Mot de passe de la partie : quiconque veut la rejoindre ou la "
                                      "regarder devra le saisir. Laisser vide pour une partie ouverte."],
        ["Permettre les spectateurs", "—", "Coché par défaut. Décoché, le bouton « Spectateur » "
                                           "n'apparaît pas pour cette partie."],
    ], (44, 26, 104))
    pdf.para(
        "Après **Créer**, vous devenez l'owner de la partie et la table de jeu s'ouvre "
        "directement. La touche Entrée dans les champs texte valide aussi le formulaire."
    )

    # ---- joining ----
    pdf.h1("Rejoindre une partie")
    pdf.para(
        "Cliquer sur **Join** sur la ligne de la partie, puis renseigner :"
    )
    pdf.bullets([
        "**Nickname** : le pseudo sous lequel vous jouerez. Il doit être différent de "
        "ceux déjà assis.",
        "**Clé d'utilisateur** (facultative) : comme à la création, elle protège votre siège.",
        "**Nationalité** : seulement si le jeu en utilise ; choisir parmi les camps proposés.",
        "**Clé d'accès au jeu** : à demander au créateur s'il en a défini une, sinon laisser vide.",
    ])
    pdf.note(
        "Le bouton **Join** disparaît quand la partie est **complète** (nombre maximum de "
        "joueurs atteint) ou **commencée**. Une partie commence quand le dernier siège est "
        "pris, ou plus tôt si son owner la lance depuis la table. Ensuite, seuls les "
        "joueurs déjà assis peuvent revenir."
    )

    pdf.h2("Reprendre sa place")
    pdf.para(
        "Si vous avez fermé l'onglet ou perdu la connexion, votre pseudo reste dans la "
        "partie et son bouton passe au **bleu**. Cliquez dessus : le pseudo est déjà "
        "rempli, il suffit de saisir la **même clé d'utilisateur** qu'à votre arrivée "
        "(rien si vous n'en aviez pas mis) et, le cas échéant, la clé d'accès de la partie. "
        "Vous retrouvez votre siège, votre nationalité et la partie dans l'état où elle est."
    )

    pdf.h2("Regarder en spectateur")
    pdf.para(
        "Le bouton **Spectateur** permet de suivre une partie sans y jouer : choisissez "
        "un pseudo et donnez la clé d'accès si la partie en a une. Un spectateur ne prend "
        "pas de siège, ne choisit pas de nationalité et ne peut pas déplacer les pièces. "
        "On peut regarder une partie déjà commencée. Le bouton n'apparaît pas si le "
        "créateur a refusé les spectateurs."
    )

    # ---- errors ----
    pdf.h1("Messages d'erreur")
    pdf.para(
        "Si le serveur refuse une demande, la fenêtre se rouvre avec votre saisie "
        "intacte et un message sous le champ concerné :"
    )
    pdf.table([
        ["Message", "Cause et solution"],
        ["Le nickname est obligatoire.", "Saisir un pseudo."],
        ["Choisissez une nationalité.", "Le jeu demande un camp : en choisir un dans la liste."],
        ["Clé d'accès refusée par le serveur.", "La clé d'accès de la partie est fausse : la redemander au créateur."],
        ["Clé d'utilisateur refusée par le serveur.", "Ce pseudo existe déjà dans la partie avec une autre "
                                                      "clé : saisir la bonne clé ou choisir un autre pseudo."],
        ["Ce pseudo est déjà en jeu.", "Ce joueur est connecté en ce moment : impossible de prendre sa place."],
        ["Cette partie n'accepte pas les spectateurs.", "Le créateur a désactivé les spectateurs."],
        ["Cette partie a déjà trop de spectateurs.", "Le nombre maximal de spectateurs est atteint."],
        ["Le serveur a refusé cette adhésion.", "La partie est pleine, commencée ou n'existe plus : "
                                                "elle disparaîtra de la liste à la prochaine mise à jour."],
        ["Le serveur a atteint son nombre maximum de parties en cours.",
         "Le site accueille au plus 20 parties en cours à la fois : réessayer quand une se sera libérée."],
    ], (66, 108))
    pdf.para(
        "Un jeu mal décrit (composants en double ou incomplets) est signalé par une "
        "fenêtre d'alerte : la partie ne peut pas être lancée tant que l'administrateur "
        "n'a pas corrigé le jeu."
    )

    # ---- good to know ----
    pdf.h1("Bon à savoir")
    pdf.bullets([
        "**Parties en cours** : le lien en haut de la page ouvre la liste des parties où "
        "au moins un joueur est connecté, tous jeux confondus, avec le nombre de parties "
        "en cours du site et sa limite (20). Quand elle est atteinte, les boutons Create, "
        "Join et Spectateur sont grisés.",
        "**Une seule partie par navigateur.** Si une table de jeu est déjà ouverte dans "
        "un autre onglet, le lobby refuse d'en ouvrir une seconde : fermez d'abord l'autre "
        "onglet. Pour jouer deux personnages, utilisez deux navigateurs différents.",
        "**Plusieurs onglets de lobby** peuvent rester ouverts : ils partagent la même "
        "connexion au serveur.",
        "**Connexion perdue** : le lobby se reconnecte seul ; la liste se rafraîchit dès "
        "le retour du serveur.",
        "**Retour au lobby** : depuis la table, le lien de retour ramène sur le jeu de la "
        "partie. Votre siège reste réservé et vous pouvez revenir par votre bouton bleu.",
    ])

    pdf.output(OUTPUT)
    print(f"written {os.path.abspath(OUTPUT)}")


if __name__ == "__main__":
    build()

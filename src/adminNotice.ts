// What the administration of OBG (the Chabanas /manage/ pages) tells the
// people of a game it closed or deleted, in the look of the inactivity popups.

export const CLOSED_BY_ADMIN_MESSAGE = "Le jeu est clos par l'administrateur";
export const DELETED_BY_ADMIN_MESSAGE = "La partie a été supprimée par l'administrateur";

/** The message of the administrator, until the reader clicks OK. */
export function showAdminPopup(message: string, onOk?: () => void): void {
  const overlay = document.createElement("div");
  overlay.className = "idle-overlay";
  const box = document.createElement("div");
  box.className = "idle-box";
  box.setAttribute("role", "alertdialog");
  box.setAttribute("aria-modal", "true");
  const text = document.createElement("p");
  text.textContent = message;
  const ok = document.createElement("button");
  ok.type = "button";
  ok.textContent = "OK";
  ok.addEventListener("click", () => {
    overlay.remove();
    onOk?.();
  });
  box.append(text, ok);
  overlay.append(box);
  document.body.append(overlay);
}

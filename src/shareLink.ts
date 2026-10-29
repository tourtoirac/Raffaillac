// "Copier le lien de la partie" in the banner of the game page: the address of
// the lobby with ?code=, which opens the tab of the game with this session first
// and highlighted (sessionList.ts). The Hautefort game pages have the same button
// (Hautefort front/common/shareLink.ts).

const LABEL = "Copier le lien de la partie";

export function lobbyLinkFor(code: string): string {
  const url = new URL("index.html", window.location.href);
  url.searchParams.set("code", code);
  return url.toString();
}

/** wires the button; `code` gives the code of the session shown, if any */
export function bindShareLink(button: HTMLButtonElement, code: () => string | undefined): void {
  button.textContent = LABEL;
  button.title = "Copie l'adresse du lobby ouvert sur cette partie, à envoyer aux autres joueurs";
  button.onclick = () => void copy(button, code());
}

async function copy(button: HTMLButtonElement, code: string | undefined): Promise<void> {
  if (!code) return;
  const link = lobbyLinkFor(code);
  try {
    // the clipboard needs https (or localhost): elsewhere the link is shown to copy by hand
    await navigator.clipboard.writeText(link);
  } catch {
    window.prompt("Copiez le lien de la partie :", link);
    return;
  }
  button.textContent = "Lien copié ✓";
  window.setTimeout(() => (button.textContent = LABEL), 2000);
}

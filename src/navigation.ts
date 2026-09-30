// Le nom du jeu d'origine circule dans l'URL : la session ne le contient pas,
// la page de jeu n'a donc aucun autre moyen de savoir d'où elle vient.
export const GAME_PARAM = "game";

function withGame(path: string, gameName: string | null): string {
  if (!gameName) return path;
  return `${path}?${GAME_PARAM}=${encodeURIComponent(gameName)}`;
}

// entrée dans la partie, onglet d'origine conservé
export function gameEntryUrl(gameName: string | null): string {
  return withGame("game.html", gameName);
}

// retour au lobby, sur l'onglet d'origine
export function lobbyReturnUrl(gameName: string | null): string {
  return withGame("index.html", gameName);
}

export function originGameName(): string | null {
  return new URLSearchParams(window.location.search).get(GAME_PARAM);
}

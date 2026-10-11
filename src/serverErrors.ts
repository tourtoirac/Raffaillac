// Wording of the server errors shown by both the lobby and the game page.

import type { ServerErrorEvent } from "./types";

// "invalid_component": the game_json describes a component the server cannot
// build. The player cannot fix it, but the message names the component so the
// author of the game can.
export function invalidComponentMessage(error: ServerErrorEvent["error"]): string {
  const lines = ["Impossible de lancer la partie : un composant de ce jeu est mal décrit."];

  const id = error?.component_id;
  let component = id ? `Composant « ${id} »` : "Composant sans identifiant";
  const where: string[] = [];
  if (error?.kind) where.push(error.kind);
  if (error?.list) where.push(`liste « ${error.list} »`);
  if (error?.parent_id) where.push(`dans « ${error.parent_id} »`);
  if (where.length > 0) component += ` (${where.join(", ")})`;
  lines.push(component);

  if (error?.missing_field) {
    lines.push(`Champ manquant : « ${error.missing_field} »`);
  } else if (error?.message) {
    // no missing field: the server message is the only description there is
    lines.push(error.message);
  }

  lines.push("Le jeu doit être corrigé.");
  return lines.join("\n\n");
}

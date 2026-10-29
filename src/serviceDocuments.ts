import type { SessionDocument } from "./types";

// The documents (rules, charts...) of each refereed service, as its lobby
// socket last gave them: set by the administration of OBG (Chabanas
// /manage/refereed/), shown above its games as those of a Chabanas game.
const documentsByService = new Map<string, SessionDocument[]>();

/** what the lobby of a refereed service says of its documents */
export function setServiceDocuments(base: URL, documents: SessionDocument[] | undefined): void {
  documentsByService.set(base.href, documents ?? []);
}

/** the documents of a refereed service; none before its lobby answered */
export function serviceDocuments(base: URL): SessionDocument[] {
  return documentsByService.get(base.href) ?? [];
}

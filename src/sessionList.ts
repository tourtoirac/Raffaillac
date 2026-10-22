// Search and pagination of the session lists, shared by the lobby (one list
// per game, Air Force included) and the page of the games in progress.

export const PAGE_SIZE = 10;

// A session matches when its code or one of its nicknames contains the query,
// whatever the case. An empty query matches everything.
export function matchesSearch(query: string, code: string | undefined, nicknames: string[]): boolean {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return true;
  if ((code ?? "").toLowerCase().includes(wanted)) return true;
  return nicknames.some((nickname) => nickname.toLowerCase().includes(wanted));
}

// The page shown of each list, by list key (a game name). A list keeps its page
// across the refreshes pushed by the server; a new search starts every list
// over at its first page.
export class Pager {
  private readonly pages = new Map<string, number>();

  constructor(private readonly onChange: () => void) {}

  reset(): void {
    this.pages.clear();
  }

  // the items of the page shown, the page being brought back in range when
  // the list got shorter
  slice<T>(key: string, items: T[]): T[] {
    const page = Math.min(this.pages.get(key) ?? 1, pageCount(items.length));
    this.pages.set(key, page);
    return items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  }

  // "Précédent / page x sur y / Suivant", or null when one page holds everything
  controls(key: string, total: number): HTMLDivElement | null {
    const count = pageCount(total);
    if (count <= 1) return null;
    const page = Math.min(this.pages.get(key) ?? 1, count);

    const bar = document.createElement("div");
    bar.className = "pager";
    const previous = document.createElement("button");
    previous.textContent = "‹ Précédent";
    previous.disabled = page <= 1;
    previous.onclick = () => this.go(key, page - 1);
    const label = document.createElement("span");
    label.textContent = `Page ${page} sur ${count} (${total} sessions)`;
    const next = document.createElement("button");
    next.textContent = "Suivant ›";
    next.disabled = page >= count;
    next.onclick = () => this.go(key, page + 1);
    bar.append(previous, label, next);
    return bar;
  }

  private go(key: string, page: number): void {
    this.pages.set(key, page);
    this.onChange();
  }
}

function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

// What a list shows when nothing is left to show: no session at all, or none
// matching the search.
export function emptyListMessage(query: string): HTMLParagraphElement {
  const message = document.createElement("p");
  message.textContent = query.trim()
    ? "Aucune session ne correspond à la recherche."
    : "Aucune session active.";
  message.style.color = "#888";
  return message;
}

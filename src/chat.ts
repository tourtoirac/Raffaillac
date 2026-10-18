// Text chat of a session, in a window at the bottom of the participants
// column.
//
// One tab for the general channel, read and written by everybody at the
// table, and for a player one tab for each other player: a private channel
// only those two read. Tourtoirac keeps the history (chat_send, chat) and
// gives it back with the session, so a reader coming back finds it again.

import type { ChatMessage } from "./types";

/** the longest message Tourtoirac accepts (chat.MAX_TEXT_LENGTH) */
const MAX_TEXT_LENGTH = 500;
const GENERAL = "";

export interface ChatHost {
  /** sends an action to Tourtoirac */
  send(message: Record<string, unknown>): void;
  /** the nickname of the reader */
  myName(): string | undefined;
}

export class ChatPanel {
  /** the messages read so far, by id: the session and the chat events overlap */
  private readonly messages = new Map<number, ChatMessage>();
  /** the other players, each with its private tab; empty for a watcher */
  private partners: string[] = [];
  /** "" for the general channel, else the nickname of the other player */
  private current = GENERAL;
  private readonly unread = new Map<string, number>();
  private collapsed = false;

  private readonly tabs: HTMLElement;
  private readonly log: HTMLElement;
  private readonly form: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private readonly toggle: HTMLButtonElement;

  constructor(
    private readonly panel: HTMLElement,
    private readonly host: ChatHost,
  ) {
    this.tabs = panel.querySelector<HTMLElement>(".chat-tabs")!;
    this.log = panel.querySelector<HTMLElement>(".chat-log")!;
    this.form = panel.querySelector<HTMLFormElement>(".chat-form")!;
    this.input = panel.querySelector<HTMLInputElement>(".chat-input")!;
    this.toggle = panel.querySelector<HTMLButtonElement>(".chat-toggle")!;
    this.input.maxLength = MAX_TEXT_LENGTH;
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.sendTyped();
    });
    this.toggle.addEventListener("click", () => this.setCollapsed(!this.collapsed));
    // the window is shown once the session is known
    panel.hidden = true;
  }

  /** The history the session gives: what the reader may read, oldest first. */
  setHistory(messages: ChatMessage[] | undefined): void {
    if (!Array.isArray(messages)) return;
    for (const message of messages) this.messages.set(message.id, message);
    this.panel.hidden = false;
    this.render();
  }

  /**
   * The other players of the game, from the participants list. A watcher
   * only has the general channel.
   */
  setPartners(players: string[], canWritePrivately: boolean): void {
    const me = this.host.myName();
    const partners = canWritePrivately ? players.filter((name) => name !== me) : [];
    // a private channel that already has messages keeps its tab
    for (const message of this.messages.values()) {
      const other = this.channelOf(message);
      if (other !== GENERAL && !partners.includes(other)) partners.push(other);
    }
    if (partners.join("\n") === this.partners.join("\n")) return;
    this.partners = partners;
    if (this.current !== GENERAL && !partners.includes(this.current)) this.current = GENERAL;
    this.render();
  }

  /** A message the server just sent: the reader may read it. */
  receive(message: ChatMessage): void {
    if (this.messages.has(message.id)) return;
    this.messages.set(message.id, message);
    const channel = this.channelOf(message);
    if (channel !== GENERAL && !this.partners.includes(channel)) this.partners.push(channel);
    const mine = message.from === this.host.myName();
    if (!mine && (channel !== this.current || this.collapsed)) {
      this.unread.set(channel, (this.unread.get(channel) ?? 0) + 1);
    }
    this.render();
  }

  private channelOf(message: ChatMessage): string {
    if (message.to === null || message.to === undefined) return GENERAL;
    return message.from === this.host.myName() ? message.to : message.from;
  }

  private sendTyped(): void {
    const text = this.input.value.trim();
    if (!text) return;
    const message: Record<string, unknown> = { action: "chat_send", text };
    if (this.current !== GENERAL) message.to = this.current;
    this.host.send(message);
    this.input.value = "";
  }

  private select(channel: string): void {
    this.current = channel;
    this.unread.delete(channel);
    this.render();
    this.input.focus();
  }

  private setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.panel.classList.toggle("collapsed", collapsed);
    // opening the window reads the channel it shows
    if (!collapsed) this.unread.delete(this.current);
    this.render();
  }

  private render(): void {
    this.renderTabs();
    this.renderLog();
    const total = [...this.unread.values()].reduce((sum, count) => sum + count, 0);
    this.toggle.textContent = this.collapsed ? (total > 0 ? `▲ ${total}` : "▲") : "▼";
    this.toggle.title = this.collapsed ? "Ouvrir le chat" : "Réduire le chat";
    this.toggle.classList.toggle("unread", this.collapsed && total > 0);
  }

  private renderTabs(): void {
    const channels = [GENERAL, ...this.partners];
    this.tabs.replaceChildren(
      ...channels.map((channel) => {
        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = "chat-tab";
        if (channel === this.current) tab.classList.add("active");
        tab.textContent = channel === GENERAL ? "Général" : channel;
        tab.title = channel === GENERAL ? "Tout le monde" : `Message privé à ${channel}`;
        const count = this.unread.get(channel) ?? 0;
        if (count > 0) {
          const badge = document.createElement("span");
          badge.className = "chat-unread";
          badge.textContent = String(count);
          tab.append(badge);
        }
        tab.addEventListener("click", () => {
          if (this.collapsed) this.setCollapsed(false);
          this.select(channel);
        });
        return tab;
      }),
    );
  }

  private renderLog(): void {
    // the reader scrolled up to read older messages: it stays there
    const atBottom = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 8;
    const me = this.host.myName();
    const shown = [...this.messages.values()]
      .filter((message) => this.channelOf(message) === this.current)
      .sort((a, b) => a.id - b.id);
    this.log.replaceChildren(
      ...shown.map((message) => {
        const line = document.createElement("div");
        line.className = "chat-line";
        if (message.from === me) line.classList.add("mine");
        const time = document.createElement("span");
        time.className = "chat-time";
        time.textContent = formatTime(message.time);
        const author = document.createElement("span");
        author.className = "chat-author";
        author.textContent = message.from;
        author.title = message.from;
        // textContent: what a player wrote is never read as HTML
        const text = document.createElement("span");
        text.className = "chat-text";
        text.textContent = message.text;
        line.append(time, author, text);
        return line;
      }),
    );
    if (atBottom || shown.length === 0 || shown[shown.length - 1].from === me) {
      this.log.scrollTop = this.log.scrollHeight;
    }
    this.input.placeholder =
      this.current === GENERAL ? "Message à tous…" : `Message privé à ${this.current}…`;
  }
}

/** The time of a message, in the time zone of the reader. */
function formatTime(time: string | null | undefined): string {
  if (!time) return "";
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

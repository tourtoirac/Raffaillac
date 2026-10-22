// What the tabs of the refereed games share (Air Force and Judge Dredd, two
// modules of Hautefort): the modals to create or join a game, with the look of
// the OBG modals of index.html, the calls to the API of the service, and the
// way into its game page. As everywhere in OBG there is no account: a
// nickname, an optional personal key to take one's seat back, an optional
// access key for the game.

/** a service published next to the lobby, whatever the public path (/ locally, /obg/ in production) */
export function serviceUrl(path: string): URL {
  return new URL(path, new URL(import.meta.env.BASE_URL, window.location.href));
}

export interface SeatGrant {
  game_id: string;
  token: string;
  nickname: string;
  role: "player" | "watcher";
  [key: string]: unknown;
}

export async function postJson(base: URL, path: string, body: unknown): Promise<SeatGrant> {
  const response = await fetch(new URL(path, base), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as SeatGrant & { error?: { message: string } };
  if (!response.ok) throw new Error(data.error?.message ?? `Erreur ${response.status}`);
  return data;
}

/**
 * Opens the game page of the service with the seat just granted. The token is
 * kept in the sessionStorage of the tab (same origin): the game page reads it
 * under `seatsKey`.
 */
export function enterServiceGame(base: URL, seatsKey: string, grant: SeatGrant): void {
  let seats: Record<string, unknown> = {};
  try {
    seats = JSON.parse(window.sessionStorage.getItem(seatsKey) ?? "{}") as Record<string, unknown>;
  } catch {
    seats = {};
  }
  const { game_id: gameId, ...seat } = grant;
  seats[gameId] = seat;
  window.sessionStorage.setItem(seatsKey, JSON.stringify(seats));
  const url = new URL(".", base);
  url.searchParams.set("game", gameId);
  window.location.href = url.toString();
}

export interface Field {
  name: string;
  label: string;
  input: HTMLInputElement | HTMLSelectElement;
}

export function textField(name: string, label: string, placeholder = "", value = "", readOnly = false): Field {
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = placeholder;
  input.value = value;
  input.readOnly = readOnly;
  return { name, label, input };
}

export function selectField(
  name: string,
  label: string,
  options: { value: string; label: string }[],
  value?: string,
): Field {
  const input = document.createElement("select");
  for (const o of options) {
    const option = document.createElement("option");
    option.value = o.value;
    option.textContent = o.label;
    input.appendChild(option);
  }
  if (value !== undefined) input.value = value;
  return { name, label, input };
}

/** the "allow watchers" box of a creation modal; read its `checked` on confirm */
export function watchersCheckbox(form: HTMLDivElement, id: string): HTMLInputElement {
  const row = document.createElement("div");
  row.className = "checkbox-row";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.id = id;
  box.checked = true;
  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = "Permettre les spectateurs";
  row.append(box, label);
  form.appendChild(row);
  return box;
}

export function openModal(
  title: string,
  fields: Field[],
  confirmLabel: string,
  onConfirm: (values: Record<string, string>) => Promise<void>,
  extra?: (form: HTMLDivElement, fields: Map<string, Field>) => void,
): void {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay show";
  const form = document.createElement("div");
  form.className = "modal-form";
  const close = document.createElement("button");
  close.className = "modal-close";
  close.type = "button";
  close.textContent = "×";
  close.onclick = () => overlay.remove();
  const heading = document.createElement("h3");
  heading.textContent = title;
  form.append(close, heading);
  const byName = new Map<string, Field>();
  for (const f of fields) {
    const label = document.createElement("label");
    label.textContent = f.label;
    form.append(label, f.input);
    byName.set(f.name, f);
  }
  extra?.(form, byName);
  const error = document.createElement("div");
  error.className = "error-msg";
  error.style.display = "none";
  const buttons = document.createElement("div");
  buttons.className = "form-buttons";
  const cancel = document.createElement("button");
  cancel.className = "btn-cancel";
  cancel.textContent = "Annuler";
  cancel.onclick = () => overlay.remove();
  const confirm = document.createElement("button");
  confirm.className = "btn-confirm";
  confirm.textContent = confirmLabel;
  confirm.onclick = async () => {
    const values: Record<string, string> = {};
    for (const [name, f] of byName) values[name] = f.input.value.trim();
    if (!values.nickname) {
      error.textContent = "Le nickname est obligatoire.";
      error.style.display = "block";
      return;
    }
    confirm.disabled = true;
    try {
      await onConfirm(values);
    } catch (e) {
      error.textContent = (e as Error).message;
      error.style.display = "block";
      confirm.disabled = false;
    }
  };
  buttons.append(cancel, confirm);
  form.append(error, buttons);
  overlay.appendChild(form);
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !confirm.disabled) confirm.click();
    if (e.key === "Escape") overlay.remove();
  });
  document.body.appendChild(overlay);
  (fields.find((f) => !(f.input as HTMLInputElement).readOnly)?.input ?? confirm).focus();
}

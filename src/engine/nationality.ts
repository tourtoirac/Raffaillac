// The nationality of a component is the list of the sides it belongs to; null,
// it belongs to every side. Tourtoirac always sends a list, but a single name,
// as games wrote it before, is still read as a list of one.

export type Nationality = readonly string[] | null;

export function readNationality(value: unknown): Nationality {
  const list = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  const read: string[] = [];
  for (const item of list) {
    if (typeof item === "string" && item.trim() && !read.includes(item.trim())) read.push(item.trim());
  }
  return read.length > 0 ? read : null;
}

/** Whether the player of that side may touch a component of that nationality. */
export function nationalityAllows(nationality: Nationality, side: string | null): boolean {
  return nationality === null || (side !== null && nationality.includes(side));
}

/** Whether a component belongs to that side by name, not merely by having no nationality. */
export function nationalityIncludes(nationality: Nationality, side: string | null): boolean {
  return nationality !== null && side !== null && nationality.includes(side);
}

/** The sides, for a message to the player. */
export function nationalityLabel(nationality: Nationality): string {
  return nationality === null ? "" : nationality.join(", ");
}

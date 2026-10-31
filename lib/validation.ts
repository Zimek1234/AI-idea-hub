export const categories = [
  "Tool",
  "Agent",
  "Skill",
  "Prompt",
  "Workflow",
  "Automation",
] as const;
export const statuses = ["To Try", "Testing", "Using", "Trash"] as const;
export type Category = (typeof categories)[number];
export type Status = (typeof statuses)[number];
export type EntryInput = {
  title: string;
  description: string;
  source_url: string | null;
  category: Category;
  tags: string[];
  notes: string;
  status: Status;
  section: "library" | "ideas";
};
export type Entry = EntryInput & {
  id: string;
  workspace_id: string;
  author_id: string;
  created_at: string;
  updated_at?: string;
};
export function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new Error("A valid ID is required.");
  return value;
}
export function text(
  value: unknown,
  name: string,
  max: number,
  required = false,
): string {
  if (value === undefined && !required) return "";
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new Error(
      `${name} must be ${required ? "1" : "0"}–${max} characters.`,
    );
  return value.trim();
}
export function normalizeUrl(value: unknown): string | null {
  if (value === "" || value === null || value === undefined) return null;
  const raw = text(value, "Source URL", 2000, true);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Enter a valid HTTP or HTTPS URL.");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Enter a public HTTP or HTTPS URL without credentials.");
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()])
    if (/^utm_|^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.toString().replace(/\/$/, "");
}
export function validateEntry(value: unknown): EntryInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Entry must be an object.");
  const v = value as Record<string, unknown>;
  if (!categories.includes(v.category as Category))
    throw new Error("Choose a valid category.");
  if (!statuses.includes(v.status as Status))
    throw new Error("Choose a valid status.");
  if (!["library", "ideas"].includes(v.section as string))
    throw new Error("Choose a valid section.");
  if (!Array.isArray(v.tags) || v.tags.length > 12)
    throw new Error("Use up to 12 tags.");
  return {
    title: text(v.title, "Title", 160, true),
    description: text(v.description, "Description", 3000),
    source_url: normalizeUrl(v.source_url),
    category: v.category as Category,
    tags: [
      ...new Set(v.tags.map((t) => text(t, "Tag", 32, true).toLowerCase())),
    ],
    notes: text(v.notes, "Notes", 10000),
    status: v.status as Status,
    section: v.section as "library" | "ideas",
  };
}
export function filterEntries(
  entries: Entry[],
  search: string,
  category: string,
  status: string,
): Entry[] {
  const q = search.toLocaleLowerCase().trim();
  return entries.filter(
    (e) =>
      (category === "All" || e.category === category) &&
      (status === "All" || e.status === status) &&
      [e.title, e.description, e.source_url, ...e.tags]
        .join(" ")
        .toLocaleLowerCase()
        .includes(q),
  );
}
export function findDuplicate(
  entries: Entry[],
  candidate: EntryInput,
  excludeId?: string,
): Entry | undefined {
  return entries.find(
    (e) =>
      e.id !== excludeId &&
      (e.title.trim().toLowerCase() === candidate.title.trim().toLowerCase() ||
        (candidate.source_url &&
          normalizeUrl(e.source_url) === candidate.source_url)),
  );
}

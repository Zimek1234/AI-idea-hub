import type { Entry } from "./validation";
export const chatEmojis = ["👍", "❤️", "🎉", "🚀", "👀", "💡"] as const;
export const CHAT_LIMIT = 3000;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function sectionLabel(section: string) {
  return section === "ideas" ? "Ideas & Projects" : "AI Library";
}
export function findShareableEntries(
  entries: Entry[],
  workspaceId: string,
  demo: boolean,
  query: string,
) {
  const search = query.trim().toLocaleLowerCase();
  return entries.filter(
    (e) =>
      (demo || e.workspace_id === workspaceId) &&
      e.status !== "Trash" &&
      [e.title, e.description, e.category, ...e.tags]
        .join(" ")
        .toLocaleLowerCase()
        .includes(search),
  );
}
export function shouldSendOnEnter(
  event: {
    key: string;
    shiftKey: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
    isComposing?: boolean;
    keyCode?: number;
  },
  composing: boolean,
) {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !composing &&
    !event.isComposing &&
    event.keyCode !== 229
  );
}
export function validateChatMessage(input: {
  body: string;
  reply_to?: string | null;
  shared_entry_id?: string | null;
}) {
  if (typeof input.body !== "string") throw new Error("Enter a message.");
  const body = input.body.trim();
  if ([...body].length > CHAT_LIMIT || (!body && !input.shared_entry_id))
    throw new Error(
      "Write a message of 1–3,000 characters or share an Idea Hub entry.",
    );
  for (const id of [input.reply_to, input.shared_entry_id])
    if (id != null && !uuid.test(id))
      throw new Error("Invalid message or entry reference.");
  return {
    body,
    reply_to: input.reply_to || null,
    shared_entry_id: input.shared_entry_id || null,
  };
}
export function validateReaction(emoji: string) {
  if (!(chatEmojis as readonly string[]).includes(emoji))
    throw new Error("Choose a supported reaction.");
  return emoji;
}
export type ChatReaction = {
  message_id: string;
  workspace_id: string;
  user_id: string;
  emoji: string;
  active: boolean;
};
export type ChatMessage = {
  id: string;
  workspace_id: string;
  author_id: string;
  author_name?: string;
  body: string;
  created_at: string;
  reply_to: string | null;
  shared_entry_id: string | null;
  shared_entry_deleted?: boolean;
  reactions: ChatReaction[];
  reply: {
    id: string;
    body: string;
    author_id: string;
    author_name?: string;
  } | null;
  shared_entry: {
    id: string;
    title: string;
    description: string;
    category: string;
    section?: "library" | "ideas";
  } | null;
};
export function mergeChatMessages(
  current: ChatMessage[],
  incoming: ChatMessage[],
) {
  return [
    ...new Map([...current, ...incoming].map((m) => [m.id, m])).values(),
  ].sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
}
export function demoConversation(
  entry: ChatMessage["shared_entry"],
): ChatMessage[] {
  // Deterministic samples keep prerendered HTML identical during hydration.
  const time = Date.UTC(2026, 9, 30, 9, 0);
  const first: ChatMessage = {
    id: "10000000-0000-4000-8000-000000000001",
    workspace_id: "demo",
    author_id: "demo-jamie",
    body: "Morning team! What should we try for our next research sprint?",
    created_at: new Date(time).toISOString(),
    reply_to: null,
    shared_entry_id: null,
    reactions: [],
    reply: null,
    shared_entry: null,
  };
  return [
    first,
    {
      ...first,
      id: "10000000-0000-4000-8000-000000000002",
      author_id: "demo-sam",
      body: "This one's been great for turning scattered notes into a starting point. Worth a look?",
      created_at: new Date(time + 60000).toISOString(),
      shared_entry_id: entry?.id || null,
      shared_entry: entry,
      reactions: [
        {
          workspace_id: "demo",
          message_id: "10000000-0000-4000-8000-000000000002",
          user_id: "demo-jamie",
          emoji: "🚀",
          active: true,
        },
      ],
    },
    {
      ...first,
      id: "10000000-0000-4000-8000-000000000003",
      author_id: "demo-jamie",
      body: "Love that. Let's compare notes here after trying it.",
      created_at: new Date(time + 120000).toISOString(),
      reply_to: first.id,
      reply: first,
    },
  ];
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatMessage } from "./chat";

// PostgREST cannot resolve the composite self-reference as an embedded reply.
// Keep the other joins, and resolve parents explicitly under the caller's RLS.
export const CHAT_MESSAGE_SELECT =
  "*, reactions:chat_reactions(*), shared_entry:entries!chat_messages_workspace_id_shared_entry_id_fkey(id,title,description,category)";
export async function loadChatReplies(
  db: SupabaseClient,
  workspaceId: string,
  messages: ChatMessage[],
): Promise<ChatMessage[]> {
  const ids = [
    ...new Set(messages.flatMap((m) => (m.reply_to ? [m.reply_to] : []))),
  ];
  const parents = new Map<string, NonNullable<ChatMessage["reply"]>>();
  // Batch so replies from many history pages do not exceed URL/request limits.
  for (let offset = 0; offset < ids.length; offset += 50) {
    const r = await db
      .from("chat_messages")
      .select("id,body,author_id,author_name")
      .eq("workspace_id", workspaceId)
      .in("id", ids.slice(offset, offset + 50));
    if (r.error) throw new ChatRequestError("reply lookup", r.error);
    for (const row of r.data) parents.set(row.id, row);
  }
  return messages.map((m) => ({
    ...m,
    reply: m.reply_to ? parents.get(m.reply_to) || null : null,
  }));
}

type BackendError = { code?: string; status?: number };
export class ChatRequestError extends Error {
  stage: string;
  code: string;
  constructor(stage: string, error: BackendError) {
    const code =
      error.code || (error.status ? `HTTP ${error.status}` : "NETWORK");
    super(`Team chat ${stage} failed (${code}).`);
    this.stage = stage;
    this.code = code;
  }
}
export function describeChatError(error: unknown, fallbackStage = "refresh") {
  const e =
    error instanceof ChatRequestError
      ? error
      : new ChatRequestError(fallbackStage, (error || {}) as BackendError);
  const reason = ["PGRST200", "PGRST201"].includes(e.code)
    ? "The database API could not resolve a query relationship. Check the deployed chat query and reload the API schema cache after schema changes."
    : ["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(e.code)
      ? "The database API is missing a required table, column, or function. Check the project and migration/schema-cache state."
      : e.code === "42501"
        ? "Database permissions denied this request. Check workspace membership, table grants, and RLS policies."
        : ["PGRST301", "PGRST302", "PGRST303", "HTTP 401"].includes(e.code)
          ? "Your session is no longer valid. Sign in again."
          : "Check your network connection and Supabase API availability, then refresh chat.";
  // Do not print raw backend errors: constraint details can contain message bodies or credentials.
  return `${e.message} ${reason}`;
}

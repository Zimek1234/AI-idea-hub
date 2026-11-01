"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import type { Entry } from "../lib/validation";
import {
  chatEmojis,
  findShareableEntries,
  sectionLabel,
  type ChatReaction,
} from "../lib/chat";

// Fixed positioning avoids clipping by scrolling history, while keeping the DOM
// inside the chat panel for its mobile focus containment.
function useChatPopover(
  open: boolean,
  anchor: RefObject<HTMLButtonElement | null>,
  popup: RefObject<HTMLDivElement | null>,
  onClose: () => void,
) {
  const close = useRef(onClose);
  close.current = onClose;
  const [position, setPosition] = useState<CSSProperties>({
    visibility: "hidden",
  });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!anchor.current || !popup.current) return;
      const a = anchor.current.getBoundingClientRect(),
        p = popup.current.getBoundingClientRect();
      const viewport = window.visualViewport;
      const originX = viewport?.offsetLeft || 0,
        originY = viewport?.offsetTop || 0;
      const width = viewport?.width || window.innerWidth,
        height = viewport?.height || window.innerHeight;
      const popupWidth = Math.min(p.width, width - 24),
        popupHeight = Math.min(p.height, height - 24);
      const left = Math.max(
        originX + 12,
        Math.min(a.left, originX + width - popupWidth - 12),
      );
      const below = a.bottom + 8;
      const top =
        below + popupHeight <= originY + height - 12
          ? below
          : Math.max(
              originY + 12,
              Math.min(
                a.top - popupHeight - 8,
                originY + height - popupHeight - 12,
              ),
            );
      setPosition({
        left,
        top,
        maxWidth: width - 24,
        maxHeight: height - 24,
        visibility: "visible",
      });
    };
    place();
    window.addEventListener("resize", place);
    const scroll = (event: Event) => {
      if (!popup.current?.contains(event.target as Node)) place();
    };
    document.addEventListener("scroll", scroll, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", scroll, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [open, anchor, popup]);
  useLayoutEffect(() => {
    // Focus only after the positioned popup is visible; browsers refuse focus
    // while visibility:hidden during its measurement render.
    if (open && position.visibility === "visible")
      popup.current
        ?.querySelector<HTMLElement>("input,button:not(:disabled)")
        ?.focus();
  }, [open, position.visibility, popup]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!popup.current?.contains(target) && !anchor.current?.contains(target))
        close.current();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open, anchor, popup]);
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (
      event.target instanceof HTMLInputElement &&
      event.key === "Enter" &&
      !event.nativeEvent.isComposing &&
      event.nativeEvent.keyCode !== 229
    )
      event.preventDefault();
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close.current();
      anchor.current?.focus();
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      if (
        event.target instanceof HTMLInputElement &&
        ["Home", "End"].includes(event.key)
      )
        return;
      const buttons = Array.from(
        popup.current?.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled)",
        ) || [],
      );
      if (!buttons.length) return;
      event.preventDefault();
      const index = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : event.key === "ArrowDown"
              ? (index + 1) % buttons.length
              : index < 0
                ? buttons.length - 1
                : (index - 1 + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  };
  return { position, onKeyDown };
}

export function EntrySharePicker({
  entries,
  workspaceId,
  demo,
  value,
  disabled,
  onChange,
}: {
  entries: Entry[];
  workspaceId: string;
  demo: boolean;
  value: string;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const anchor = useRef<HTMLButtonElement>(null),
    popup = useRef<HTMLDivElement>(null);
  const id = useId();
  const { position, onKeyDown } = useChatPopover(open, anchor, popup, () =>
    setOpen(false),
  );
  const options = findShareableEntries(entries, workspaceId, demo, query);
  const selected = entries.find((e) => e.id === value);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  return (
    <div className="chat-share-picker">
      <button
        ref={anchor}
        type="button"
        className="chat-share-trigger"
        aria-label="Share from Idea Hub"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={id}
        disabled={disabled}
        onClick={() => {
          setOpen(!open);
          setQuery("");
        }}
      >
        ＋ Share from Idea Hub <span aria-hidden="true">⌄</span>
      </button>
      {selected && (
        <div className="chat-share-selection">
          <span>
            {sectionLabel(selected.section)} · <strong>{selected.title}</strong>
          </span>
          <button
            type="button"
            aria-label="Remove shared entry"
            disabled={disabled}
            onClick={() => onChange("")}
          >
            ×
          </button>
        </div>
      )}
      {open && (
        <div
          ref={popup}
          id={id}
          role="dialog"
          aria-label="Share from Idea Hub"
          className="chat-popover chat-share-popover"
          style={position}
          onKeyDown={onKeyDown}
        >
          <input
            type="search"
            aria-label="Search Idea Hub entries"
            placeholder="Search tools, ideas, projects…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="chat-share-results">
            {(["library", "ideas"] as const).map((section) => (
              <section key={section} aria-label={sectionLabel(section)}>
                <h3>{sectionLabel(section)}</h3>
                {options
                  .filter((e) => e.section === section)
                  .map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      aria-label={`${entry.title} · ${sectionLabel(section)}`}
                      onClick={() => {
                        setOpen(false);
                        onChange(entry.id);
                      }}
                    >
                      <strong>{entry.title}</strong>
                      <small>
                        {entry.category}
                        {entry.tags.length
                          ? ` · ${entry.tags.slice(0, 2).join(", ")}`
                          : ""}
                      </small>
                    </button>
                  ))}
                {!options.some((e) => e.section === section) && (
                  <p>No matching entries</p>
                )}
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function MessageReactions({
  reactions,
  userId,
  author,
  disabled,
  busy,
  name,
  onReact,
}: {
  reactions: ChatReaction[];
  userId: string;
  author: string;
  disabled: boolean;
  busy: boolean;
  name: (id: string) => string;
  onReact: (emoji: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null),
    popup = useRef<HTMLDivElement>(null);
  const id = useId();
  const { position, onKeyDown } = useChatPopover(open, anchor, popup, () =>
    setOpen(false),
  );
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  async function choose(emoji: string) {
    setOpen(false);
    anchor.current?.focus();
    await onReact(emoji);
    if (document.activeElement === document.body) anchor.current?.focus();
  }
  return (
    <div className="chat-reactions" aria-label="Emoji reactions">
      {chatEmojis.map((emoji) => {
        const rows = reactions.filter((r) => r.active && r.emoji === emoji);
        if (!rows.length) return null;
        return (
          <button
            key={emoji}
            className="chat-reaction-badge"
            aria-label={`Toggle ${emoji} reaction to message from ${author}, ${rows.length} ${rows.length === 1 ? "reaction" : "reactions"}`}
            aria-pressed={rows.some((r) => r.user_id === userId)}
            title={rows.map((r) => name(r.user_id)).join(", ")}
            disabled={disabled || busy}
            onClick={() => void onReact(emoji)}
          >
            {emoji}
            <span>{rows.length}</span>
          </button>
        );
      })}
      <button
        ref={anchor}
        type="button"
        className="chat-reaction-trigger"
        aria-label={`Add reaction to message from ${author}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">☺＋</span>
      </button>
      {open && (
        <div
          ref={popup}
          id={id}
          role="dialog"
          aria-label="Choose a reaction"
          className="chat-popover chat-reaction-popover"
          style={position}
          onKeyDown={onKeyDown}
        >
          {chatEmojis.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`React ${emoji} to message from ${author}`}
              aria-pressed={reactions.some(
                (r) => r.user_id === userId && r.emoji === emoji && r.active,
              )}
              disabled={disabled || busy}
              onClick={() => void choose(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

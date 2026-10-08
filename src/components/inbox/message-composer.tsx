"use client";

import { useState, useRef, useCallback, useMemo, useId, KeyboardEvent } from "react";
import Link from "next/link";
import {
  Send,
  LayoutTemplate,
  Paperclip,
  X,
  FileText,
  Lock,
  StickyNote,
  Zap,
  AtSign,
  ImageIcon,
  Film,
  Music,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/client";
import type { ChannelCapabilities } from "@/lib/channels/types";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_BYTES,
  attachmentKind,
} from "@/lib/channels/capabilities";
import {
  matchQuickReplies,
  renderQuickReply,
  replaceToken,
  slashQuery,
  type QuickReplyVars,
} from "@/lib/inbox/quick-replies";
import { extractMentions, filterMentionCandidates, mentionQuery, type MentionCandidate } from "@/lib/inbox/mentions";
import type { QuickReply, QuickReplyAttachment } from "@/lib/inbox/types";
import { ReplyQuote } from "./reply-quote";

interface ReplyDraft {
  /** Internal UUID of the message being replied to — sent back through onSend. */
  id: string;
  authorLabel: string;
  preview: string;
}

export type ComposerMode = "reply" | "note";

interface MessageComposerProps {
  conversationId: string;
  /** The channel's reply window has closed (customer must write first / template needed). */
  sessionExpired: boolean;
  /** What the channel supports; drives templates / attachments / the expired banner. */
  capabilities: ChannelCapabilities;
  onSend: (text: string, replyToId?: string) => void;
  onOpenTemplates: () => void;
  /** Upload + send a file; `caption` is the composer text. Resolves when done. */
  onSendAttachment?: (file: File, caption: string, replyToId?: string) => Promise<boolean>;
  replyTo?: ReplyDraft | null;
  onClearReply?: () => void;
  /** Save an internal note (never sent to the customer). */
  onSendNote?: (text: string, mentionIds: string[]) => Promise<boolean>;
  /** Teammates that can be @mentioned in notes. */
  mentionCandidates?: MentionCandidate[];
  /** Quick replies available to the user ("/" menu). */
  quickReplies?: QuickReply[];
  /** Values for {nombre} {negocio} {agente} {fecha}. */
  quickReplyVars?: QuickReplyVars;
  /** Send a quick reply's stored attachments as media messages. */
  onSendQuickAttachments?: (attachments: QuickReplyAttachment[]) => Promise<void>;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const ATTACHMENT_ICON = { image: ImageIcon, video: Film, audio: Music, document: FileText } as const;
const EMPTY_CANDIDATES: MentionCandidate[] = [];
const EMPTY_REPLIES: QuickReply[] = [];
const EMPTY_VARS: QuickReplyVars = {};

type MenuState =
  | { kind: "slash"; start: number; items: QuickReply[] }
  | { kind: "mention"; start: number; items: MentionCandidate[] }
  | null;

export function MessageComposer({
  conversationId,
  sessionExpired,
  capabilities,
  onSend,
  onOpenTemplates,
  onSendAttachment,
  replyTo,
  onClearReply,
  onSendNote,
  mentionCandidates = EMPTY_CANDIDATES,
  quickReplies = EMPTY_REPLIES,
  quickReplyVars = EMPTY_VARS,
  onSendQuickAttachments,
}: MessageComposerProps) {
  const { t } = useI18n();
  const menuId = useId();
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [mode, setMode] = useState<ComposerMode>("reply");
  const [sending, setSending] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [quickAttachments, setQuickAttachments] = useState<QuickReplyAttachment[]>([]);
  const [menuIndex, setMenuIndex] = useState(0);
  const [menuDismissedAt, setMenuDismissedAt] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset drafts when switching conversations.
  const [lastConversationId, setLastConversationId] = useState(conversationId);
  if (lastConversationId !== conversationId) {
    setLastConversationId(conversationId);
    setFile(null);
    setFilePreview(null);
    setQuickAttachments([]);
    setMode("reply");
  }

  const isNote = mode === "note";
  const notesEnabled = !!onSendNote;
  const templatesEnabled = capabilities.templates && !isNote;
  const attachmentsEnabled = capabilities.media && !!onSendAttachment && !isNote;
  // Notes can always be written: the reply window only limits customer messages.
  const inputDisabled = !isNote && sessionExpired;

  // ── "/" quick replies and "@" mentions menu ───────────────────────
  const menu: MenuState = useMemo(() => {
    if (inputDisabled) return null;
    if (isNote) {
      const tok = mentionQuery(text, caret);
      if (!tok || tok.start === menuDismissedAt) return null;
      return { kind: "mention", start: tok.start, items: filterMentionCandidates(mentionCandidates, tok.query) };
    }
    const tok = slashQuery(text, caret);
    if (!tok || tok.start === menuDismissedAt) return null;
    return { kind: "slash", start: tok.start, items: matchQuickReplies(quickReplies, tok.query) };
  }, [inputDisabled, isNote, text, caret, menuDismissedAt, mentionCandidates, quickReplies]);
  const menuOpen = !!menu;
  const activeIndex = menu && menu.items.length ? Math.min(menuIndex, menu.items.length - 1) : 0;

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    // Max ~6 lines
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, []);

  const setTextAndCaret = useCallback(
    (next: string, nextCaret: number) => {
      setText(next);
      setCaret(nextCaret);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(nextCaret, nextCaret);
        adjustHeight();
      });
    },
    [adjustHeight],
  );

  const pickQuickReply = useCallback(
    (qr: QuickReply, start: number) => {
      const body = renderQuickReply(qr.body, quickReplyVars);
      const { text: next, caret: c } = replaceToken(text, start, caret, body);
      setTextAndCaret(next, c);
      setMenuIndex(0);
      if (qr.attachments?.length) {
        if (!capabilities.media) {
          toast.warning(t("inboxpro.composer.attachmentsNotSupported"));
        } else {
          setQuickAttachments((prev) => [...prev, ...qr.attachments].slice(0, 10));
        }
      }
    },
    [text, caret, quickReplyVars, setTextAndCaret, capabilities.media, t],
  );

  const pickMention = useCallback(
    (m: MentionCandidate, start: number) => {
      const { text: next, caret: c } = replaceToken(text, start, caret, `@${m.name} `);
      setTextAndCaret(next, c);
      setMenuIndex(0);
    },
    [text, caret, setTextAndCaret],
  );

  const pickActive = useCallback(() => {
    if (!menu || !menu.items.length) return false;
    if (menu.kind === "slash") pickQuickReply(menu.items[activeIndex], menu.start);
    else pickMention(menu.items[activeIndex], menu.start);
    return true;
  }, [menu, activeIndex, pickQuickReply, pickMention]);

  // ── Files ──────────────────────────────────────────────────────────
  const clearFile = useCallback(() => {
    if (filePreview) URL.revokeObjectURL(filePreview);
    setFile(null);
    setFilePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [filePreview]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const picked = e.target.files?.[0];
      e.target.value = "";
      if (!picked) return;
      if (!attachmentKind(picked.type)) {
        toast.error(t("inbox.composer.fileTypeNotAllowed"));
        return;
      }
      if (picked.size > ATTACHMENT_MAX_BYTES) {
        toast.error(t("inbox.composer.fileTooLarge", { max: "16 MB" }));
        return;
      }
      if (filePreview) URL.revokeObjectURL(filePreview);
      setFile(picked);
      setFilePreview(picked.type.startsWith("image/") ? URL.createObjectURL(picked) : null);
    },
    [filePreview, t],
  );

  const resetText = useCallback(() => {
    setText("");
    setCaret(0);
    setMenuDismissedAt(null);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, []);

  // ── Send ───────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (sending || inputDisabled) return;

    if (isNote) {
      if (!trimmed || !onSendNote) return;
      setSending(true);
      try {
        const ok = await onSendNote(trimmed, extractMentions(trimmed, mentionCandidates));
        if (ok) resetText();
      } finally {
        setSending(false);
      }
      return;
    }

    if (file && onSendAttachment) {
      setSending(true);
      try {
        const ok = await onSendAttachment(file, trimmed, replyTo?.id);
        if (ok) {
          clearFile();
          resetText();
        }
      } finally {
        setSending(false);
      }
      return;
    }

    if (!trimmed && !quickAttachments.length) return;
    setSending(true);
    try {
      if (trimmed) onSend(trimmed, replyTo?.id);
      resetText();
      if (quickAttachments.length && onSendQuickAttachments) {
        const pending = quickAttachments;
        setQuickAttachments([]);
        await onSendQuickAttachments(pending);
      }
    } finally {
      setSending(false);
    }
  }, [
    text,
    sending,
    inputDisabled,
    isNote,
    onSendNote,
    mentionCandidates,
    resetText,
    file,
    onSendAttachment,
    replyTo?.id,
    clearFile,
    quickAttachments,
    onSend,
    onSendQuickAttachments,
  ]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (menuOpen && menu) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          if (!menu.items.length) return;
          e.preventDefault();
          const delta = e.key === "ArrowDown" ? 1 : -1;
          setMenuIndex((activeIndex + delta + menu.items.length) % menu.items.length);
          return;
        }
        if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
          if (pickActive()) {
            e.preventDefault();
            return;
          }
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setMenuDismissedAt(menu.start);
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [menuOpen, menu, activeIndex, pickActive, handleSend],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      setCaret(e.target.selectionStart ?? e.target.value.length);
      setMenuIndex(0);
      adjustHeight();
    },
    [adjustHeight],
  );

  const syncCaret = useCallback((e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    setCaret(e.currentTarget.selectionStart ?? 0);
  }, []);

  const switchMode = (next: ComposerMode) => {
    setMode(next);
    setMenuDismissedAt(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const windowHours = capabilities.replyWindowHours ?? 24;
  const optionId = (i: number) => `${menuId}-opt-${i}`;
  const canSend = isNote ? !!text.trim() : !!text.trim() || !!file || quickAttachments.length > 0;

  return (
    <div className={cn("border-t p-3", isNote ? "border-yellow-500/40 bg-yellow-950/40" : "border-slate-800 bg-slate-900")}>
      {notesEnabled && (
        <div
          role="radiogroup"
          aria-label={t("inboxpro.composer.modeLabel")}
          className="mb-2 inline-flex rounded-lg border border-slate-700 bg-slate-800 p-0.5"
        >
          {(["reply", "note"] as const).map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => switchMode(m)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                    e.preventDefault();
                    switchMode(m === "reply" ? "note" : "reply");
                  }
                }}
                tabIndex={active ? 0 : -1}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  active
                    ? m === "note"
                      ? "bg-yellow-200 text-yellow-950"
                      : "bg-primary text-primary-foreground"
                    : "text-slate-300 hover:text-white",
                )}
              >
                {m === "note" ? <StickyNote className="h-3.5 w-3.5" aria-hidden="true" /> : <Send className="h-3.5 w-3.5" aria-hidden="true" />}
                {m === "note" ? t("inboxpro.composer.note") : t("inboxpro.composer.reply")}
              </button>
            );
          })}
        </div>
      )}

      {replyTo && !isNote && (
        <div className="mb-2">
          <ReplyQuote
            authorLabel={replyTo.authorLabel}
            preview={replyTo.preview}
            onDismiss={onClearReply}
          />
        </div>
      )}
      {isNote && (
        <p className="mb-2 flex items-center gap-1.5 text-xs text-yellow-200">
          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t("inboxpro.composer.noteHint")}
        </p>
      )}
      {!isNote && sessionExpired && templatesEnabled && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-amber-500/10 px-3 py-2">
          <p className="text-xs text-amber-400">
            {t("inbox.composer.windowExpiredTemplate", { hours: windowHours })}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 text-xs text-amber-400 hover:text-amber-300"
            onClick={onOpenTemplates}
          >
            <LayoutTemplate className="mr-1 h-3 w-3" />
            {t("inbox.composer.templates")}
          </Button>
        </div>
      )}
      {!isNote && sessionExpired && !templatesEnabled && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2">
          <Lock className="h-3.5 w-3.5 shrink-0 text-amber-400" />
          <p className="text-xs text-amber-400">
            {t("inbox.composer.windowExpiredWait", { hours: windowHours })}
          </p>
        </div>
      )}

      {file && !isNote && (
        <div className="mb-2 flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2">
          {filePreview ? (
            <img src={filePreview} alt="" className="h-10 w-10 rounded object-cover" />
          ) : (
            <FileText className="h-6 w-6 shrink-0 text-slate-400" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-white">{file.name}</p>
            <p className="text-[10px] text-slate-500">{formatBytes(file.size)}</p>
          </div>
          <button
            type="button"
            onClick={clearFile}
            disabled={sending}
            aria-label={t("inbox.composer.removeAttachment")}
            className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-700 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {quickAttachments.length > 0 && !isNote && (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label={t("inboxpro.composer.quickReplyAttachments")}>
          {quickAttachments.map((a, i) => {
            const Icon = ATTACHMENT_ICON[a.type] ?? FileText;
            return (
              <li
                key={`${a.path ?? a.url}-${i}`}
                className="inline-flex max-w-56 items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 py-1 pl-2 pr-1 text-xs text-slate-200"
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                <span className="truncate">{a.name}</span>
                <button
                  type="button"
                  onClick={() => setQuickAttachments((prev) => prev.filter((_, j) => j !== i))}
                  aria-label={t("inboxpro.composer.removeQuickAttachment", { name: a.name })}
                  className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-700 hover:text-white"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="relative flex items-end gap-2">
        {menu && (
          <div
            className="absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-lg border border-slate-700 bg-slate-800 shadow-xl sm:right-auto sm:w-96"
          >
            <p className="flex items-center gap-1.5 border-b border-slate-700 px-3 py-1.5 text-[11px] font-medium text-slate-400">
              {menu.kind === "slash" ? <Zap className="h-3 w-3" aria-hidden="true" /> : <AtSign className="h-3 w-3" aria-hidden="true" />}
              {menu.kind === "slash" ? t("inboxpro.composer.quickReplies") : t("inboxpro.composer.mentions")}
            </p>
            <ul id={menuId} role="listbox" aria-label={menu.kind === "slash" ? t("inboxpro.composer.quickReplies") : t("inboxpro.composer.mentions")} className="max-h-64 overflow-y-auto py-1">
              {menu.items.length === 0 && (
                <li className="px-3 py-2 text-xs text-slate-400" role="presentation">
                  {menu.kind === "slash"
                    ? quickReplies.length
                      ? t("inboxpro.composer.noQuickReplies")
                      : t("inboxpro.composer.noQuickRepliesYet")
                    : t("inboxpro.composer.noMembers")}
                </li>
              )}
              {menu.kind === "slash" &&
                menu.items.map((qr, i) => (
                  <li
                    key={qr.id}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === activeIndex}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickQuickReply(qr, menu.start);
                    }}
                    onMouseEnter={() => setMenuIndex(i)}
                    className={cn("cursor-pointer px-3 py-1.5", i === activeIndex ? "bg-slate-700" : "")}
                  >
                    <p className="flex items-center gap-2 text-sm text-white">
                      <span className="font-mono text-xs text-primary">/{qr.shortcut}</span>
                      <span className="truncate">{qr.title}</span>
                      {qr.attachments?.length > 0 && <Paperclip className="h-3 w-3 shrink-0 text-slate-400" aria-label={t("inboxpro.composer.hasAttachments")} />}
                    </p>
                    {qr.body && <p className="truncate text-xs text-slate-400">{qr.body}</p>}
                  </li>
                ))}
              {menu.kind === "mention" &&
                menu.items.map((m, i) => (
                  <li
                    key={m.userId}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === activeIndex}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickMention(m, menu.start);
                    }}
                    onMouseEnter={() => setMenuIndex(i)}
                    className={cn("cursor-pointer px-3 py-1.5 text-sm text-white", i === activeIndex ? "bg-slate-700" : "")}
                  >
                    @{m.name}
                  </li>
                ))}
            </ul>
            {menu.kind === "slash" && (
              <Link
                href="/settings?tab=quick-replies"
                className="block border-t border-slate-700 px-3 py-1.5 text-[11px] text-primary hover:underline"
              >
                {t("inboxpro.composer.manageQuickReplies")}
              </Link>
            )}
          </div>
        )}

        {templatesEnabled && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 shrink-0 p-0 text-slate-400 hover:text-white"
            onClick={onOpenTemplates}
            title={t("inbox.composer.sendTemplate")}
            aria-label={t("inbox.composer.sendTemplate")}
          >
            <LayoutTemplate className="h-4 w-4" />
          </Button>
        )}

        {attachmentsEnabled && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              className="hidden"
              onChange={handleFileChange}
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 shrink-0 p-0 text-slate-400 hover:text-white"
              onClick={() => fileInputRef.current?.click()}
              disabled={inputDisabled || sending}
              title={t("inbox.composer.attach")}
              aria-label={t("inbox.composer.attach")}
            >
              <Paperclip className="h-4 w-4" />
            </Button>
          </>
        )}

        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          onBlur={() => setMenuDismissedAt(menu?.start ?? null)}
          onFocus={() => setMenuDismissedAt(null)}
          placeholder={
            isNote
              ? t("inboxpro.composer.notePlaceholder")
              : inputDisabled
                ? templatesEnabled
                  ? t("inbox.composer.placeholderExpiredTemplate")
                  : t("inbox.composer.placeholderExpiredWait")
                : file
                  ? t("inbox.composer.placeholderCaption")
                  : t("inboxpro.composer.placeholder")
          }
          aria-label={isNote ? t("inboxpro.composer.note") : t("inbox.composer.placeholder")}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          aria-activedescendant={menuOpen && menu && menu.items.length ? optionId(activeIndex) : undefined}
          disabled={inputDisabled}
          rows={1}
          className={cn(
            "flex-1 resize-none rounded-xl border px-4 py-2.5 text-sm outline-none transition-colors",
            isNote
              ? "border-yellow-400/60 bg-yellow-50 text-yellow-950 placeholder-yellow-800/70 focus:border-yellow-400"
              : "border-slate-700 bg-slate-800 text-white placeholder-slate-500 focus:border-primary/50",
            inputDisabled && "cursor-not-allowed opacity-50"
          )}
        />

        <Button
          size="sm"
          className={cn(
            "h-9 w-9 shrink-0 p-0 disabled:opacity-40",
            isNote ? "bg-yellow-300 text-yellow-950 hover:bg-yellow-200" : "bg-primary hover:bg-primary/90",
          )}
          disabled={!canSend || inputDisabled || sending}
          onClick={() => void handleSend()}
          aria-label={isNote ? t("inboxpro.composer.sendNote") : t("inbox.composer.send")}
          title={isNote ? t("inboxpro.composer.sendNote") : t("inbox.composer.send")}
        >
          {sending ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : isNote ? (
            <StickyNote className="h-4 w-4" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

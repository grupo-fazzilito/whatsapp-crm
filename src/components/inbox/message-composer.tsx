"use client";

import { useState, useRef, useCallback, KeyboardEvent } from "react";
import { Send, LayoutTemplate, Paperclip, X, FileText, Lock } from "lucide-react";
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
import { ReplyQuote } from "./reply-quote";

interface ReplyDraft {
  /** Internal UUID of the message being replied to — sent back through onSend. */
  id: string;
  authorLabel: string;
  preview: string;
}

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
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function MessageComposer({
  conversationId,
  sessionExpired,
  capabilities,
  onSend,
  onOpenTemplates,
  onSendAttachment,
  replyTo,
  onClearReply,
}: MessageComposerProps) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset the pending attachment when switching conversations.
  const [lastConversationId, setLastConversationId] = useState(conversationId);
  if (lastConversationId !== conversationId) {
    setLastConversationId(conversationId);
    setFile(null);
    setFilePreview(null);
  }

  const templatesEnabled = capabilities.templates;
  const attachmentsEnabled = capabilities.media && !!onSendAttachment;
  const inputDisabled = sessionExpired;

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    // Max 4 lines (~96px)
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, []);

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
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (sending || inputDisabled) return;

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

    if (!trimmed) return;
    setSending(true);
    try {
      onSend(trimmed, replyTo?.id);
      resetText();
    } finally {
      setSending(false);
    }
  }, [text, sending, inputDisabled, file, onSendAttachment, replyTo?.id, clearFile, resetText, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      adjustHeight();
    },
    [adjustHeight]
  );

  const windowHours = capabilities.replyWindowHours ?? 24;

  return (
    <div className="border-t border-slate-800 bg-slate-900 p-3">
      {replyTo && (
        <div className="mb-2">
          <ReplyQuote
            authorLabel={replyTo.authorLabel}
            preview={replyTo.preview}
            onDismiss={onClearReply}
          />
        </div>
      )}
      {sessionExpired && templatesEnabled && (
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
      {sessionExpired && !templatesEnabled && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2">
          <Lock className="h-3.5 w-3.5 shrink-0 text-amber-400" />
          <p className="text-xs text-amber-400">
            {t("inbox.composer.windowExpiredWait", { hours: windowHours })}
          </p>
        </div>
      )}

      {file && (
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

      <div className="flex items-end gap-2">
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
          placeholder={
            inputDisabled
              ? templatesEnabled
                ? t("inbox.composer.placeholderExpiredTemplate")
                : t("inbox.composer.placeholderExpiredWait")
              : file
                ? t("inbox.composer.placeholderCaption")
                : t("inbox.composer.placeholder")
          }
          aria-label={t("inbox.composer.placeholder")}
          disabled={inputDisabled}
          rows={1}
          className={cn(
            "flex-1 resize-none rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-primary/50",
            inputDisabled && "cursor-not-allowed opacity-50"
          )}
        />

        <Button
          size="sm"
          className="h-9 w-9 shrink-0 bg-primary p-0 hover:bg-primary/90 disabled:opacity-40"
          disabled={(!text.trim() && !file) || inputDisabled || sending}
          onClick={handleSend}
          aria-label={t("inbox.composer.send")}
        >
          {sending ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

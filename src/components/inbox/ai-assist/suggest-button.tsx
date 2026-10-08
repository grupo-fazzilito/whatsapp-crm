"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/client";
import { assistErrorText, assistFetch } from "./api";

interface SuggestReplyButtonProps {
  conversationId: string;
  /** What the agent already typed: sent as a hint and replaced by the improved draft. */
  currentText: string;
  disabled?: boolean;
  /** Puts the draft in the composer (never sends it). */
  onDraft: (draft: string) => void;
}

/** ✨ "Sugerir respuesta": AI draft in the conversation agent's voice, editable before sending. */
export function SuggestReplyButton({ conversationId, currentText, disabled, onDraft }: SuggestReplyButtonProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const hasDraft = !!currentText.trim();
  const label = busy ? t("aiassist.suggest.loading") : hasDraft ? t("aiassist.suggest.buttonWithDraft") : t("aiassist.suggest.button");

  const run = async () => {
    setBusy(true);
    const r = await assistFetch<{ draft: string }>(`conversations/${conversationId}/suggest`, {
      body: hasDraft ? { hint: currentText.trim() } : {},
    });
    setBusy(false);
    if (!r.ok) {
      toast.error(assistErrorText(t, r.code, "text"));
      return;
    }
    onDraft(r.data.draft);
    toast.success(t("aiassist.suggest.ready"));
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-9 w-9 shrink-0 p-0 text-violet-300 hover:bg-violet-500/10 hover:text-violet-200"
      onClick={() => void run()}
      disabled={disabled || busy}
      title={label}
      aria-label={label}
      aria-busy={busy}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
    </Button>
  );
}

"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/types";
import type { Team } from "@/lib/inbox/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { TeamMemberInfo } from "./use-inbox-extras";

interface TransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  members: TeamMemberInfo[];
  teams: Team[];
  currentUserId: string | null;
  currentAssigneeId: string | null;
  onTransferred: (conversation: Conversation) => void;
}

const fieldClass =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function TransferDialog({
  open,
  onOpenChange,
  conversationId,
  members,
  teams,
  currentUserId,
  currentAssigneeId,
  onTransferred,
}: TransferDialogProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"member" | "team">("member");
  const [memberId, setMemberId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  // Reset the form every time the dialog opens.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setMode("member");
      setMemberId("");
      setTeamId("");
      setReason("");
    }
  }

  const nameOf = (m: TeamMemberInfo) => m.full_name || m.email;
  const canSubmit = mode === "member" ? !!memberId : !!teamId;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(mode === "member" ? { to_user_id: memberId } : { team_id: teamId }),
          ...(mode === "member" && teamId ? { team_id: teamId } : {}),
          reason: reason.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.conversation) throw new Error(data?.error || `HTTP ${res.status}`);
      onTransferred(data.conversation as Conversation);
      const assigned = members.find((m) => m.user_id === data.assigned_to);
      if (assigned) toast.success(t("inboxpro.transfer.done", { name: nameOf(assigned) }));
      else toast.success(t("inboxpro.transfer.doneTeam", { name: teams.find((x) => x.id === teamId)?.name ?? "" }));
      onOpenChange(false);
    } catch (err) {
      toast.error(t("inboxpro.transfer.failed", { reason: err instanceof Error ? err.message : "error" }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("inboxpro.transfer.title")}</DialogTitle>
            <DialogDescription>{t("inboxpro.transfer.description")}</DialogDescription>
          </DialogHeader>

          <div role="radiogroup" aria-label={t("inboxpro.transfer.target")} className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            {(["member", "team"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  "h-8 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  mode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "member" ? t("inboxpro.transfer.toMember") : t("inboxpro.transfer.toTeam")}
              </button>
            ))}
          </div>

          {mode === "member" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="transfer-member">{t("inboxpro.transfer.memberLabel")}</Label>
              <select
                id="transfer-member"
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
                className={fieldClass}
                required
              >
                <option value="">{t("inboxpro.transfer.pickMember")}</option>
                {members
                  .filter((m) => m.user_id !== currentAssigneeId)
                  .map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {nameOf(m)}
                      {m.user_id === currentUserId ? ` ${t("inboxpro.transfer.you")}` : ""}
                      {!m.available ? ` — ${t("inboxpro.transfer.unavailable")}` : ""}
                    </option>
                  ))}
              </select>
              {teams.length > 0 && (
                <>
                  <Label htmlFor="transfer-member-team" className="mt-2">
                    {t("inboxpro.transfer.teamOptional")}
                  </Label>
                  <select
                    id="transfer-member-team"
                    value={teamId}
                    onChange={(e) => setTeamId(e.target.value)}
                    className={fieldClass}
                  >
                    <option value="">{t("inboxpro.transfer.noTeam")}</option>
                    {teams.map((tm) => (
                      <option key={tm.id} value={tm.id}>
                        {tm.name}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
          ) : teams.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("inboxpro.transfer.noTeams")}</p>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="transfer-team">{t("inboxpro.transfer.teamLabel")}</Label>
              <select
                id="transfer-team"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                className={fieldClass}
                required
              >
                <option value="">{t("inboxpro.transfer.pickTeam")}</option>
                {teams.map((tm) => (
                  <option key={tm.id} value={tm.id}>
                    {tm.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">{t("inboxpro.transfer.autoPick")}</p>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="transfer-reason">{t("inboxpro.transfer.reason")}</Label>
            <textarea
              id="transfer-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder={t("inboxpro.transfer.reasonPlaceholder")}
              className="w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("inboxpro.transfer.cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit || busy}>
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {t("inboxpro.transfer.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

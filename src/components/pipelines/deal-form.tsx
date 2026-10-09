"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { apiJson } from "@/lib/crm/api-client";
import type { Contact, Deal, PipelineStage, Profile } from "@/types";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Check, X, Trash2, MessageSquare, Loader2, RotateCcw, ListTodo } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/client";
import { useWorkspace } from "@/hooks/use-workspace";
import { useMembers } from "@/components/crm/use-members";
import { setDealStatus } from "@/components/crm/close-deal-dialog";
import { CreateTaskDialog } from "@/components/crm/create-task-dialog";

interface DealFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: Deal | null;
  pipelineId: string;
  stages: PipelineStage[];
  defaultStageId?: string;
  onSaved: () => void;
  /** Opens the won / lost dialog (reason) for this deal. */
  onRequestClose?: (deal: Deal, status: "won" | "lost") => void;
}

const selectCls =
  "h-9 w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-sm text-white outline-none focus:border-primary focus:ring-1 focus:ring-primary";

export function DealForm({
  open,
  onOpenChange,
  deal,
  pipelineId,
  stages,
  defaultStageId,
  onSaved,
  onRequestClose,
}: DealFormProps) {
  const { t, locale } = useI18n();
  const { workspace } = useWorkspace();
  const { members } = useMembers();
  const wsCurrency = workspace?.currency || "USD";

  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState(wsCurrency);
  const [contactId, setContactId] = useState("");
  const [stageId, setStageId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [notes, setNotes] = useState("");

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [linkedConversationId, setLinkedConversationId] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);

  const currencies = useMemo(
    () => Array.from(new Set([wsCurrency, deal?.currency || wsCurrency, "USD", "EUR"])),
    [wsCurrency, deal?.currency],
  );

  // Reset the form fields every time the sheet opens or its input
  // props change. This is a legitimate prop-driven sync; the rule is
  // over-cautious here, hence the block-level disable.
   
  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    if (deal) {
      setTitle(deal.title);
      setValue(String(deal.value ?? ""));
      setCurrency(deal.currency || wsCurrency);
      // contact_id is nullable when the contact has been deleted
      // (migration 004: ON DELETE SET NULL). "" means "no selection".
      setContactId(deal.contact_id ?? "");
      setStageId(deal.stage_id);
      setAssignedTo(deal.assigned_to ?? "");
      setExpectedCloseDate(deal.expected_close_date ?? "");
      setNotes(deal.notes ?? "");
    } else {
      setTitle("");
      setValue("");
      setCurrency(wsCurrency);
      setContactId("");
      setStageId(defaultStageId || stages[0]?.id || "");
      setAssignedTo("");
      setExpectedCloseDate("");
      setNotes("");
    }
  }, [open, deal, defaultStageId, stages, wsCurrency]);
   

  // Load supporting data once the sheet is open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const c = await apiJson<{ contacts: Contact[] }>("/api/crm/contacts").catch(() => null);
      if (cancelled) return;
      setContacts(c?.contacts ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Owners: profiles of this workspace's active members.
  useEffect(() => {
    if (!open || members.length === 0) return;
    let cancelled = false;
    apiJson<{ profiles: Profile[] }>("/api/crm/owners")
      .catch(() => null)
      .then((data) => {
        if (!cancelled) setProfiles(data?.profiles ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [open, members]);

  // Chat to open: the deal's own conversation, else the contact's latest.
  useEffect(() => {
    if (!open || !contactId) {
       
      setLinkedConversationId(null);
      return;
    }
    if (deal?.conversation_id && deal.contact_id === contactId) {
      setLinkedConversationId(deal.conversation_id);
      return;
    }
    let cancelled = false;
    (async () => {
      const data = await apiJson<{ id: string | null }>(`/api/crm/contacts/${contactId}/conversation`).catch(() => null);
      if (cancelled) return;
      setLinkedConversationId(data?.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, contactId, deal?.conversation_id, deal?.contact_id]);

  async function handleSave() {
    if (!title.trim() || !contactId || !stageId) {
      toast.error(t("crm.deals.errors.required"));
      return;
    }
    setSaving(true);

    const payload = {
      title: title.trim(),
      value: parseFloat(value) || 0,
      currency,
      contact_id: contactId,
      pipeline_id: pipelineId,
      stage_id: stageId,
      assigned_to: assignedTo || null,
      notes: notes.trim() || null,
      expected_close_date: expectedCloseDate || null,
    };

    if (deal) {
      const ok = await apiJson(`/api/crm/deals/${deal.id}`, { method: "PATCH", body: payload }).then(
        () => true,
        () => false,
      );
      if (!ok) {
        toast.error(t("crm.deals.errors.saveFailed"));
        setSaving(false);
        return;
      }
    } else {
      const ok = await apiJson("/api/crm/deals", { method: "POST", body: { ...payload, conversation_id: linkedConversationId } }).then(
        () => true,
        () => false,
      );
      if (!ok) {
        toast.error(t("crm.deals.errors.createFailed"));
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    toast.success(deal ? t("crm.deals.toast.updated") : t("crm.deals.toast.created"));
    onOpenChange(false);
    onSaved();
  }

  async function handleReopen() {
    if (!deal) return;
    setReopening(true);
    try {
      await setDealStatus(deal.id, "open");
      toast.success(t("crm.deals.toast.reopened"));
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error(t("crm.deals.errors.statusFailed"));
    } finally {
      setReopening(false);
    }
  }

  async function handleDelete() {
    if (!deal) return;
    setDeleting(true);
    const ok = await apiJson(`/api/crm/deals/${deal.id}`, { method: "DELETE" }).then(
      () => true,
      () => false,
    );
    setDeleting(false);
    if (!ok) {
      toast.error(t("crm.deals.errors.deleteFailed"));
      return;
    }
    toast.success(t("crm.deals.toast.deleted"));
    setConfirmDelete(false);
    onOpenChange(false);
    onSaved();
  }

  const closedAt = deal?.status === "won" ? deal.won_at : deal?.status === "lost" ? deal.lost_at : null;
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full border-slate-700 bg-slate-900 p-0 text-slate-200 sm:max-w-lg">
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-slate-700/50 p-4">
            <SheetTitle className="text-white">{deal ? t("crm.deals.form.editTitle") : t("crm.deals.form.newTitle")}</SheetTitle>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <div className="grid gap-2">
              <Label htmlFor="deal-title" className="text-slate-300">
                {t("crm.deals.fields.title")}
              </Label>
              <Input
                id="deal-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("crm.deals.fields.titlePlaceholder")}
                className="border-slate-700 bg-slate-800 text-white"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="deal-contact" className="text-slate-300">
                {t("crm.deals.fields.contact")}
              </Label>
              <select id="deal-contact" value={contactId} onChange={(e) => setContactId(e.target.value)} className={selectCls}>
                <option value="">{t("crm.deals.fields.selectContact")}</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.phone}
                  </option>
                ))}
              </select>

              {linkedConversationId && (
                <Link
                  href={`/inbox?c=${linkedConversationId}`}
                  className="mt-1 inline-flex items-center gap-1.5 self-start rounded-md bg-primary/10 px-2 py-1 text-xs text-primary hover:bg-primary/20"
                >
                  <MessageSquare className="h-3 w-3" aria-hidden />
                  {t("crm.deals.form.openChat")}
                </Link>
              )}
            </div>

            <div className="grid grid-cols-[1fr_110px] gap-3">
              <div className="grid gap-2">
                <Label htmlFor="deal-value" className="text-slate-300">
                  {t("crm.deals.fields.value", { currency })}
                </Label>
                <Input
                  id="deal-value"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="0"
                  className="border-slate-700 bg-slate-800 text-white"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="deal-currency" className="text-slate-300">
                  {t("crm.deals.fields.currency")}
                </Label>
                <select id="deal-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={selectCls}>
                  {currencies.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="deal-close" className="text-slate-300">
                {t("crm.deals.fields.expectedClose")}
              </Label>
              <Input
                id="deal-close"
                type="date"
                value={expectedCloseDate}
                onChange={(e) => setExpectedCloseDate(e.target.value)}
                className="border-slate-700 bg-slate-800 text-white"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="deal-stage" className="text-slate-300">
                {t("crm.deals.fields.stage")}
              </Label>
              <select id="deal-stage" value={stageId} onChange={(e) => setStageId(e.target.value)} className={selectCls}>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="deal-owner" className="text-slate-300">
                {t("crm.deals.fields.owner")}
              </Label>
              <select id="deal-owner" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className={selectCls}>
                <option value="">{t("crm.tasks.unassigned")}</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="deal-notes" className="text-slate-300">
                {t("crm.deals.fields.notes")}
              </Label>
              <Textarea
                id="deal-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("crm.deals.fields.notesPlaceholder")}
                className="min-h-[100px] border-slate-700 bg-slate-800 text-white"
              />
            </div>

            {deal && (
              <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/50 p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{t("crm.deals.form.status")}</p>
                {deal.status === "won" || deal.status === "lost" ? (
                  <div className="space-y-1 text-sm">
                    <p className={deal.status === "won" ? "font-medium text-primary" : "font-medium text-red-400"}>
                      {deal.status === "won" ? t("crm.deals.status.won") : t("crm.deals.status.lost")}
                      {closedAt ? ` · ${dateTime.format(new Date(closedAt))}` : ""}
                    </p>
                    {deal.status === "lost" && deal.lost_reason && (
                      <p className="text-slate-300">{t("crm.deals.reasonLabel", { reason: deal.lost_reason })}</p>
                    )}
                    {deal.close_note && <p className="whitespace-pre-wrap text-slate-400">{deal.close_note}</p>}
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={handleReopen}
                      disabled={reopening}
                      className="w-full text-slate-300 hover:text-white"
                    >
                      {reopening ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="mr-1 h-4 w-4" />}
                      {t("crm.deals.actions.reopen")}
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      onClick={() => onRequestClose?.(deal, "won")}
                      className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      <Check className="mr-1 h-4 w-4" />
                      {t("crm.deals.actions.markWon")}
                    </Button>
                    <Button
                      type="button"
                      onClick={() => onRequestClose?.(deal, "lost")}
                      className="flex-1 bg-red-600 text-white hover:bg-red-700"
                    >
                      <X className="mr-1 h-4 w-4" />
                      {t("crm.deals.actions.markLost")}
                    </Button>
                  </div>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setTaskOpen(true)}
                  className="w-full border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800"
                >
                  <ListTodo className="mr-1 h-4 w-4" />
                  {t("crm.tasks.create.button")}
                </Button>
              </div>
            )}
          </div>

          <div className="border-t border-slate-700/50 bg-slate-900/80 p-4">
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="flex-1 border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800"
              >
                {t("crm.common.cancel")}
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !title.trim() || !contactId || !stageId}
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? t("crm.common.saving") : deal ? t("crm.common.saveChanges") : t("crm.deals.create.submit")}
              </Button>
            </div>

            {deal &&
              (confirmDelete ? (
                <div role="alert" className="mt-3 flex items-center justify-between gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">
                  <span className="text-red-300">{t("crm.deals.form.confirmDelete")}</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      disabled={deleting}
                      className="rounded px-2 py-1 text-slate-300 hover:bg-slate-800"
                    >
                      {t("crm.common.cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {deleting ? t("crm.common.deleting") : t("crm.common.confirm")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="mt-3 flex w-full items-center justify-center gap-1 text-xs text-red-400 hover:text-red-300"
                >
                  <Trash2 className="h-3 w-3" aria-hidden />
                  {t("crm.deals.form.delete")}
                </button>
              ))}
          </div>
        </div>
        {deal && (
          <CreateTaskDialog
            open={taskOpen}
            onOpenChange={setTaskOpen}
            contactId={deal.contact_id}
            conversationId={linkedConversationId}
            dealId={deal.id}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

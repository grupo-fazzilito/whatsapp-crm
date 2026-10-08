'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { isOtherReason, lostReasons } from '@/lib/crm/reasons';
import { cn } from '@/lib/utils';
import { notifyCrmChanged } from '@/lib/crm/tasks';

export type CloseStatus = 'won' | 'lost';

export interface ClosedDeal {
  id: string;
  status: 'open' | 'won' | 'lost';
  won_at: string | null;
  lost_at: string | null;
  lost_reason: string | null;
  close_note: string | null;
}

interface Props {
  deal: { id: string; title: string } | null;
  /** Which action the dialog confirms; null = closed. */
  status: CloseStatus | null;
  onOpenChange: (open: boolean) => void;
  onDone: (deal: ClosedDeal) => void;
}

/** Calls POST /api/deals/[id]/status. Exported for quick actions (reopen). */
export async function setDealStatus(id: string, status: 'open' | CloseStatus, reason?: string | null, note?: string | null) {
  const res = await fetch(`/api/deals/${id}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, reason, note }),
  });
  const data = (await res.json().catch(() => ({}))) as { deal?: ClosedDeal; error?: string };
  if (!res.ok || !data.deal) throw new Error(data.error || String(res.status));
  notifyCrmChanged();
  return data.deal;
}

/** "Ganado" (optional note) / "Perdido" (reason from the workspace list + details). */
export function CloseDealDialog({ deal, status, onOpenChange, onDone }: Props) {
  const { t, locale } = useI18n();
  const { workspace } = useWorkspace();
  const reasons = useMemo(() => lostReasons(workspace?.settings, locale), [workspace?.settings, locale]);
  const noteId = useId();
  const groupId = useId();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const open = !!deal && !!status;

  useEffect(() => {
    if (!open) return;
     
    setReason('');
    setNote('');
     
  }, [open, deal?.id, status]);

  const needsDetails = status === 'lost' && !!reason && isOtherReason(reason);
  const canSubmit = status === 'won' || (!!reason && (!needsDetails || !!note.trim()));

  const submit = async () => {
    if (!deal || !status || !canSubmit) return;
    setSaving(true);
    try {
      const updated = await setDealStatus(deal.id, status, status === 'lost' ? reason : null, note.trim() || null);
      toast.success(status === 'won' ? t('crm.deals.toast.won') : t('crm.deals.toast.lost'));
      onDone(updated);
      onOpenChange(false);
    } catch {
      toast.error(t('crm.deals.errors.statusFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{status === 'won' ? t('crm.deals.close.wonTitle') : t('crm.deals.close.lostTitle')}</DialogTitle>
          <DialogDescription className="line-clamp-2">{deal?.title}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {status === 'lost' && (
            <fieldset className="grid gap-2">
              <legend id={groupId} className="mb-1 text-sm font-medium">
                {t('crm.deals.close.reason')}
              </legend>
              <div role="radiogroup" aria-labelledby={groupId} className="flex flex-wrap gap-1.5">
                {reasons.map((r) => (
                  <label
                    key={r}
                    className={cn(
                      'cursor-pointer rounded-full border px-3 py-1.5 text-sm transition-colors focus-within:ring-2 focus-within:ring-ring',
                      reason === r ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <input type="radio" name="lost-reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="sr-only" />
                    {r}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <div className="grid gap-1.5">
            <label htmlFor={noteId} className="text-sm font-medium">
              {needsDetails ? t('crm.deals.close.detailsRequired') : t('crm.deals.close.note')}
            </label>
            <Textarea
              id={noteId}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={2000}
              required={needsDetails}
              placeholder={status === 'won' ? t('crm.deals.close.wonPlaceholder') : t('crm.deals.close.lostPlaceholder')}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('crm.common.cancel')}
            </Button>
            <Button type="submit" disabled={saving || !canSubmit} variant={status === 'lost' ? 'destructive' : 'default'}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {status === 'won' ? t('crm.deals.close.wonSubmit') : t('crm.deals.close.lostSubmit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

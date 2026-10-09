'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Handshake, Loader2 } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { apiJson } from '@/lib/crm/api-client';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { selectClass } from '@/components/business/shared';
import { useMembers } from './use-members';
import { notifyCrmChanged } from '@/lib/crm/tasks';

interface PipelineOpt {
  id: string;
  name: string;
}
interface StageOpt {
  id: string;
  name: string;
  position: number;
  pipeline_id: string;
}
interface ProfileOpt {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
}

export interface CreatedDeal {
  id: string;
  title: string;
  value: number;
  currency: string | null;
  pipeline_id: string;
  stage_id: string;
  status: string;
}

export interface CreateDealDialogProps {
  conversationId?: string | null;
  contactId: string;
  /** Prefills the title; fetched from the contact when omitted. */
  contactName?: string | null;
  /** Controlled mode. When omitted the component renders its own trigger button. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCreated?: (deal: CreatedDeal) => void;
  /** Custom trigger content (uncontrolled mode). */
  trigger?: ReactNode;
  triggerClassName?: string;
}

/** "Crear negocio" from a conversation: pipeline + stage + title + value + owner. */
export function CreateDealDialog({
  conversationId,
  contactId,
  contactName,
  open: openProp,
  onOpenChange,
  onCreated,
  trigger,
  triggerClassName,
}: CreateDealDialogProps) {
  const { t } = useI18n();
  const { workspace, can } = useWorkspace();
  const { members, meId } = useMembers();
  const [openState, setOpenState] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openState;
  const setOpen = (v: boolean) => {
    if (!controlled) setOpenState(v);
    onOpenChange?.(v);
  };

  const ids = { title: useId(), pipeline: useId(), stage: useId(), value: useId(), owner: useId(), close: useId() };
  const [pipelines, setPipelines] = useState<PipelineOpt[] | null>(null);
  const [stages, setStages] = useState<StageOpt[]>([]);
  const [profiles, setProfiles] = useState<ProfileOpt[]>([]);
  const [pipelineId, setPipelineId] = useState('');
  const [stageId, setStageId] = useState('');
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [closeDate, setCloseDate] = useState('');
  const [saving, setSaving] = useState(false);
  const currency = workspace?.currency ?? 'USD';

  // Load pipelines, stages and the contact name when the dialog opens.
  useEffect(() => {
    if (!open || !workspace) return;
    let cancelled = false;
    (async () => {
      const [p, c] = await Promise.all([
        apiJson<{ pipelines: PipelineOpt[]; stages: StageOpt[] }>('/api/crm/pipelines').catch(() => null),
        contactName !== undefined
          ? Promise.resolve({ contact: { name: contactName, phone: null } })
          : apiJson<{ contact: { name: string | null; phone: string | null } }>(`/api/crm/contacts/${contactId}`).catch(() => null),
      ]);
      if (cancelled) return;
      const list = p?.pipelines ?? [];
      setPipelines(list);
      setStages(p?.stages ?? []);
      setPipelineId(list[0]?.id ?? '');
      const contact = c?.contact ?? null;
      setTitle((contact?.name || contact?.phone || '').slice(0, 200));
      setValue('');
      setCloseDate('');
    })();
    return () => {
      cancelled = true;
    };
  }, [open, workspace, contactId, contactName]);

  // Owner options: profiles of active members (deals.assigned_to → profiles.id).
  useEffect(() => {
    if (!open || members.length === 0) return;
    let cancelled = false;
    apiJson<{ profiles: ProfileOpt[] }>('/api/crm/owners')
      .catch(() => null)
      .then((data) => {
        if (cancelled) return;
        const list = data?.profiles ?? [];
        setProfiles(list);
        setOwnerId(list.find((pr) => pr.user_id === meId)?.id ?? '');
      });
    return () => {
      cancelled = true;
    };
  }, [open, members, meId]);

  const pipelineStages = stages.filter((s) => s.pipeline_id === pipelineId);
  useEffect(() => {
    // First stage of the selected pipeline.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStageId(stages.filter((s) => s.pipeline_id === pipelineId).sort((a, b) => a.position - b.position)[0]?.id ?? '');
  }, [pipelineId, stages]);

  const submit = async () => {
    if (!workspace || !title.trim() || !pipelineId || !stageId) return;
    const amount = value.trim() ? Number(value.replace(',', '.')) : 0;
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error(t('crm.deals.errors.invalidValue'));
      return;
    }
    setSaving(true);
    const data = await apiJson<{ deal: CreatedDeal }>('/api/crm/deals', {
      method: 'POST',
      body: {
        pipeline_id: pipelineId,
        stage_id: stageId,
        contact_id: contactId,
        conversation_id: conversationId || null,
        title: title.trim().slice(0, 200),
        value: Math.round(amount * 100) / 100,
        currency,
        assigned_to: ownerId || null,
        expected_close_date: closeDate || null,
      },
    })
      .then((r) => r.deal)
      .catch(() => null);
    setSaving(false);
    if (!data) {
      toast.error(t('crm.deals.errors.createFailed'));
      return;
    }
    toast.success(t('crm.deals.toast.created'));
    onCreated?.(data);
    notifyCrmChanged();
    setOpen(false);
  };

  return (
    <>
      {!controlled && (
        <Button type="button" variant="outline" size="sm" className={triggerClassName} onClick={() => setOpen(true)}>
          {trigger ?? (
            <>
              <Handshake className="size-3.5" />
              {t('crm.deals.create.button')}
            </>
          )}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('crm.deals.create.title')}</DialogTitle>
            <DialogDescription>{t('crm.deals.create.description')}</DialogDescription>
          </DialogHeader>
          {pipelines === null ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={t('crm.common.loading')} />
            </div>
          ) : pipelines.length === 0 ? (
            <div className="grid gap-3 text-sm text-muted-foreground">
              <p>{can('admin') ? t('crm.deals.create.noPipelinesAdmin') : t('crm.deals.create.noPipelines')}</p>
              {can('admin') && (
                <Link href="/pipelines" className="text-primary underline-offset-4 hover:underline">
                  {t('crm.deals.create.goToPipelines')}
                </Link>
              )}
            </div>
          ) : (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <div className="grid gap-1.5">
                <label htmlFor={ids.title} className="text-sm font-medium">
                  {t('crm.deals.fields.title')}
                </label>
                <Input id={ids.title} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required autoFocus />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <label htmlFor={ids.pipeline} className="text-sm font-medium">
                    {t('crm.deals.fields.pipeline')}
                  </label>
                  <select id={ids.pipeline} className={selectClass} value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
                    {pipelines.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <label htmlFor={ids.stage} className="text-sm font-medium">
                    {t('crm.deals.fields.stage')}
                  </label>
                  <select id={ids.stage} className={selectClass} value={stageId} onChange={(e) => setStageId(e.target.value)} required>
                    {pipelineStages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <label htmlFor={ids.value} className="text-sm font-medium">
                    {t('crm.deals.fields.value', { currency })}
                  </label>
                  <Input id={ids.value} type="number" inputMode="decimal" min={0} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" />
                </div>
                <div className="grid gap-1.5">
                  <label htmlFor={ids.close} className="text-sm font-medium">
                    {t('crm.deals.fields.expectedClose')}
                  </label>
                  <Input id={ids.close} type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <label htmlFor={ids.owner} className="text-sm font-medium">
                  {t('crm.deals.fields.owner')}
                </label>
                <select id={ids.owner} className={selectClass} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                  <option value="">{t('crm.tasks.unassigned')}</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name || p.email}
                    </option>
                  ))}
                </select>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  {t('crm.common.cancel')}
                </Button>
                <Button type="submit" disabled={saving || !title.trim() || !stageId}>
                  {saving && <Loader2 className="size-4 animate-spin" />}
                  {t('crm.deals.create.submit')}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

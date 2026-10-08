'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ListTodo, Loader2 } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { createClient } from '@/lib/supabase/client';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { selectClass } from '@/components/business/shared';
import { TASK_SELECT, notifyCrmChanged, presetDue, type TaskPriority, type TaskRow } from '@/lib/crm/tasks';
import { AssigneeSelect, DueField, PrioritySelect } from '@/components/tasks/task-fields';
import { useMembers } from './use-members';

export interface CreateTaskDialogProps {
  conversationId?: string | null;
  contactId?: string | null;
  /** Preselects the deal (otherwise the contact's open deals are offered). */
  dealId?: string | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCreated?: (task: TaskRow) => void;
  trigger?: ReactNode;
  triggerClassName?: string;
}

/** "Crear tarea" linked to a conversation / contact / deal. Assignee defaults to me. */
export function CreateTaskDialog({
  conversationId,
  contactId,
  dealId,
  open: openProp,
  onOpenChange,
  onCreated,
  trigger,
  triggerClassName,
}: CreateTaskDialogProps) {
  const { t } = useI18n();
  const { workspace } = useWorkspace();
  const { members, meId } = useMembers();
  const [openState, setOpenState] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openState;
  const setOpen = (v: boolean) => {
    if (!controlled) setOpenState(v);
    onOpenChange?.(v);
  };

  const titleId = useId();
  const descId = useId();
  const dealSelId = useId();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueAt, setDueAt] = useState<string | null>(null);
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [assignee, setAssignee] = useState<string | null>(null);
  const [deal, setDeal] = useState<string>('');
  const [deals, setDeals] = useState<{ id: string; title: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setTitle('');
    setDescription('');
    setDueAt(presetDue('tomorrow')?.toISOString() ?? null);
    setPriority('normal');
    setDeal(dealId ?? '');
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, dealId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setAssignee(meId);
  }, [open, meId]);

  useEffect(() => {
    if (!open || !contactId || !workspace) return;
    let cancelled = false;
    createClient()
      .from('deals')
      .select('id, title')
      .eq('workspace_id', workspace.id)
      .eq('contact_id', contactId)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (!cancelled) setDeals((data ?? []) as { id: string; title: string }[]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, contactId, workspace]);

  const submit = async () => {
    if (!workspace || !title.trim()) return;
    setSaving(true);
    const { data, error } = await createClient()
      .from('tasks')
      .insert({
        workspace_id: workspace.id,
        title: title.trim().slice(0, 300),
        description: description.trim() || null,
        due_at: dueAt,
        priority,
        assignee_user_id: assignee,
        contact_id: contactId || null,
        conversation_id: conversationId || null,
        deal_id: deal || null,
      })
      .select(TASK_SELECT)
      .single();
    setSaving(false);
    if (error || !data) {
      toast.error(t('crm.tasks.errors.createFailed'));
      return;
    }
    toast.success(t('crm.tasks.toast.created'));
    onCreated?.(data as TaskRow);
    notifyCrmChanged();
    setOpen(false);
  };

  return (
    <>
      {!controlled && (
        <Button type="button" variant="outline" size="sm" className={triggerClassName} onClick={() => setOpen(true)}>
          {trigger ?? (
            <>
              <ListTodo className="size-3.5" />
              {t('crm.tasks.create.button')}
            </>
          )}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('crm.tasks.create.title')}</DialogTitle>
            <DialogDescription>{t('crm.tasks.create.description')}</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="grid gap-1.5">
              <label htmlFor={titleId} className="text-sm font-medium">
                {t('crm.tasks.fields.title')}
              </label>
              <Input
                id={titleId}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={300}
                required
                autoFocus
                placeholder={t('crm.tasks.fields.titlePlaceholder')}
              />
            </div>
            <DueField value={dueAt} onChange={setDueAt} />
            <div className="grid gap-3 sm:grid-cols-2">
              <PrioritySelect value={priority} onChange={setPriority} />
              <AssigneeSelect value={assignee} onChange={setAssignee} members={members} meId={meId} />
            </div>
            {deals.length > 0 && (
              <div className="grid gap-1.5">
                <label htmlFor={dealSelId} className="text-sm font-medium">
                  {t('crm.tasks.fields.deal')}
                </label>
                <select id={dealSelId} className={selectClass} value={deal} onChange={(e) => setDeal(e.target.value)}>
                  <option value="">{t('crm.tasks.noDeal')}</option>
                  {deals.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="grid gap-1.5">
              <label htmlFor={descId} className="text-sm font-medium">
                {t('crm.tasks.fields.description')}
              </label>
              <Textarea id={descId} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={5000} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t('crm.common.cancel')}
              </Button>
              <Button type="submit" disabled={saving || !title.trim()}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                {t('crm.tasks.create.submit')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

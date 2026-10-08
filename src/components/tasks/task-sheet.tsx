'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Ban, CheckCircle2, Loader2, MessageSquare, RotateCcw, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { createClient } from '@/lib/supabase/client';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { selectClass } from '@/components/business/shared';
import { TASK_SELECT, type TaskPriority, type TaskRow } from '@/lib/crm/tasks';
import { useMembers } from '@/components/crm/use-members';
import { AssigneeSelect, DueField, PrioritySelect } from './task-fields';
import { ContactPicker, type ContactLite } from './contact-picker';
import { CompleteTaskDialog } from './complete-task-dialog';

interface Props {
  taskId: string | null;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}

/** Side sheet to view / edit one task. */
export function TaskSheet({ taskId, onOpenChange, onChanged }: Props) {
  const { t, locale } = useI18n();
  const { workspace } = useWorkspace();
  const { members, meId } = useMembers();
  const ids = { title: useId(), desc: useId(), deal: useId() };

  const [task, setTask] = useState<TaskRow | null>(null);
  const [missing, setMissing] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueAt, setDueAt] = useState<string | null>(null);
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [assignee, setAssignee] = useState<string | null>(null);
  const [contact, setContact] = useState<ContactLite | null>(null);
  const [dealId, setDealId] = useState('');
  const [deals, setDeals] = useState<{ id: string; title: string }[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [completing, setCompleting] = useState(false);

  const fill = (row: TaskRow) => {
    setTask(row);
    setTitle(row.title);
    setDescription(row.description ?? '');
    setDueAt(row.due_at);
    setPriority(row.priority);
    setAssignee(row.assignee_user_id);
    setContact(row.contact ? { id: row.contact.id, name: row.contact.name, phone: row.contact.phone } : null);
    setDealId(row.deal_id ?? '');
  };

  useEffect(() => {
    if (!taskId || !workspace) return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setTask(null);
    setMissing(false);
    setConfirmDelete(false);
    /* eslint-enable react-hooks/set-state-in-effect */
    createClient()
      .from('tasks')
      .select(TASK_SELECT)
      .eq('id', taskId)
      .eq('workspace_id', workspace.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (!data) setMissing(true);
        else fill(data as TaskRow);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, workspace]);

  // Deals of the selected contact + the chat to open.
  const contactId = contact?.id ?? null;
  useEffect(() => {
    if (!workspace || !contactId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDeals([]);
      setChatId(task?.conversation_id ?? null);
      return;
    }
    let cancelled = false;
    const db = createClient();
    Promise.all([
      db.from('deals').select('id, title, status').eq('workspace_id', workspace.id).eq('contact_id', contactId).order('created_at', { ascending: false }).limit(30),
      task?.conversation_id && task.contact_id === contactId
        ? Promise.resolve({ data: { id: task.conversation_id } })
        : db.from('conversations').select('id').eq('workspace_id', workspace.id).eq('contact_id', contactId).order('last_message_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
    ]).then(([d, c]) => {
      if (cancelled) return;
      setDeals(((d.data ?? []) as { id: string; title: string; status: string }[]).filter((x) => x.status === 'open' || x.id === task?.deal_id));
      setChatId((c.data as { id: string } | null)?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [workspace, contactId, task?.conversation_id, task?.contact_id, task?.deal_id]);

  const update = async (patch: Record<string, unknown>, okMsg: string) => {
    if (!task || !workspace) return false;
    const { data, error } = await createClient()
      .from('tasks')
      .update(patch)
      .eq('id', task.id)
      .eq('workspace_id', workspace.id)
      .select(TASK_SELECT)
      .single();
    if (error || !data) {
      toast.error(t('crm.tasks.errors.saveFailed'));
      return false;
    }
    fill(data as TaskRow);
    toast.success(okMsg);
    onChanged();
    return true;
  };

  const save = async () => {
    if (!title.trim()) {
      toast.error(t('crm.tasks.errors.titleRequired'));
      return;
    }
    setSaving(true);
    const contactChanged = (contact?.id ?? null) !== task?.contact_id;
    await update(
      {
        title: title.trim().slice(0, 300),
        description: description.trim() || null,
        due_at: dueAt,
        priority,
        assignee_user_id: assignee,
        contact_id: contact?.id ?? null,
        deal_id: dealId || null,
        // A different contact means a different chat.
        ...(contactChanged ? { conversation_id: contact ? chatId : null } : {}),
      },
      t('crm.tasks.toast.saved'),
    );
    setSaving(false);
  };

  const setStatus = async (status: 'open' | 'cancelled') => {
    setBusy(true);
    await update({ status, ...(status === 'open' ? { result: null } : {}) }, status === 'open' ? t('crm.tasks.toast.reopened') : t('crm.tasks.toast.cancelled'));
    setBusy(false);
  };

  const remove = async () => {
    if (!task || !workspace) return;
    setBusy(true);
    const { error } = await createClient().from('tasks').delete().eq('id', task.id).eq('workspace_id', workspace.id);
    setBusy(false);
    if (error) {
      toast.error(t('crm.tasks.errors.deleteFailed'));
      return;
    }
    toast.success(t('crm.tasks.toast.deleted'));
    onChanged();
    onOpenChange(false);
  };

  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const memberName = (uid: string | null) => members.find((m) => m.userId === uid)?.name ?? t('crm.tasks.someone');

  return (
    <Sheet open={!!taskId} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto data-[side=right]:sm:max-w-lg">
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle>{t('crm.tasks.sheet.title')}</SheetTitle>
          <SheetDescription>
            {task ? t('crm.tasks.sheet.created', { date: dateTime.format(new Date(task.created_at)), name: memberName(task.created_by) }) : ' '}
          </SheetDescription>
        </SheetHeader>

        {missing ? (
          <p className="p-4 text-sm text-muted-foreground">{t('crm.tasks.sheet.notFound')}</p>
        ) : !task ? (
          <div className="flex justify-center py-12">
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={t('crm.common.loading')} />
          </div>
        ) : (
          <form
            className="grid gap-4 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            {task.status !== 'open' && (
              <div
                className={
                  task.status === 'done'
                    ? 'grid gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm'
                    : 'grid gap-1 rounded-lg border border-border bg-muted/50 p-3 text-sm'
                }
              >
                <p className="flex items-center gap-1.5 font-medium">
                  {task.status === 'done' ? <CheckCircle2 aria-hidden className="size-4 text-emerald-700 dark:text-emerald-400" /> : <Ban aria-hidden className="size-4" />}
                  {task.status === 'done'
                    ? t('crm.tasks.sheet.doneBy', {
                        name: memberName(task.completed_by),
                        date: task.completed_at ? dateTime.format(new Date(task.completed_at)) : '',
                      })
                    : t('crm.tasks.status.cancelled')}
                </p>
                {task.result && <p className="whitespace-pre-wrap text-muted-foreground">{task.result}</p>}
              </div>
            )}

            <div className="grid gap-1.5">
              <label htmlFor={ids.title} className="text-sm font-medium">
                {t('crm.tasks.fields.title')}
              </label>
              <Input id={ids.title} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} required />
            </div>
            <DueField value={dueAt} onChange={setDueAt} />
            <div className="grid gap-3 sm:grid-cols-2">
              <PrioritySelect value={priority} onChange={setPriority} />
              <AssigneeSelect value={assignee} onChange={setAssignee} members={members} meId={meId} />
            </div>
            <ContactPicker
              value={contact}
              onChange={(c) => {
                setContact(c);
                setDealId('');
              }}
            />
            {contact && deals.length > 0 && (
              <div className="grid gap-1.5">
                <label htmlFor={ids.deal} className="text-sm font-medium">
                  {t('crm.tasks.fields.deal')}
                </label>
                <select id={ids.deal} className={selectClass} value={dealId} onChange={(e) => setDealId(e.target.value)}>
                  <option value="">{t('crm.tasks.noDeal')}</option>
                  {deals.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {chatId && (
              <Link
                href={`/inbox?c=${chatId}`}
                className="inline-flex items-center gap-1.5 self-start rounded-md bg-primary/10 px-2.5 py-1.5 text-sm text-primary hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <MessageSquare aria-hidden className="size-4" />
                {t('crm.tasks.openChat')}
              </Link>
            )}
            <div className="grid gap-1.5">
              <label htmlFor={ids.desc} className="text-sm font-medium">
                {t('crm.tasks.fields.description')}
              </label>
              <Textarea id={ids.desc} value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={5000} />
            </div>

            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              <Button type="submit" disabled={saving || !title.trim()}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                {t('crm.common.save')}
              </Button>
              {task.status === 'open' ? (
                <>
                  <Button type="button" variant="outline" onClick={() => setCompleting(true)}>
                    <CheckCircle2 className="size-4" />
                    {t('crm.tasks.actions.complete')}
                  </Button>
                  <Button type="button" variant="ghost" disabled={busy} onClick={() => setStatus('cancelled')}>
                    <Ban className="size-4" />
                    {t('crm.tasks.actions.cancel')}
                  </Button>
                </>
              ) : (
                <Button type="button" variant="outline" disabled={busy} onClick={() => setStatus('open')}>
                  <RotateCcw className="size-4" />
                  {t('crm.tasks.actions.reopen')}
                </Button>
              )}
            </div>
            {confirmDelete ? (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
                <span>{t('crm.tasks.sheet.confirmDelete')}</span>
                <span className="flex gap-1">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>
                    {t('crm.common.cancel')}
                  </Button>
                  <Button type="button" size="sm" variant="destructive" onClick={remove} disabled={busy}>
                    {t('crm.common.delete')}
                  </Button>
                </span>
              </div>
            ) : (
              <Button type="button" variant="ghost" size="sm" className="justify-self-start text-destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-3.5" />
                {t('crm.tasks.actions.delete')}
              </Button>
            )}
          </form>
        )}
        <CompleteTaskDialog
          task={completing ? task : null}
          onOpenChange={(o) => !o && setCompleting(false)}
          onCompleted={(done) => {
            fill(done);
            onChanged();
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

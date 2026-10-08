'use client';

import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { notifyCrmChanged, presetDue, type TaskRow } from '@/lib/crm/tasks';
import { DueField } from './task-fields';

interface Props {
  task: Pick<TaskRow, 'id' | 'title'> | null;
  onOpenChange: (open: boolean) => void;
  onCompleted: (task: TaskRow, followUp: TaskRow | null) => void;
}

/** "Completar tarea": optional result + optional follow-up task. */
export function CompleteTaskDialog({ task, onOpenChange, onCompleted }: Props) {
  const { t } = useI18n();
  const resultId = useId();
  const fuTitleId = useId();
  const [result, setResult] = useState('');
  const [followUp, setFollowUp] = useState(false);
  const [fuTitle, setFuTitle] = useState('');
  const [fuDue, setFuDue] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!task) return;
    // Fresh form each time the dialog opens for a task.
     
    setResult('');
    setFollowUp(false);
    setFuTitle(t('crm.tasks.complete.followUpDefault', { title: task.title }).slice(0, 300));
    setFuDue(presetDue('tomorrow')?.toISOString() ?? null);
  }, [task, t]);

  const submit = async () => {
    if (!task) return;
    if (followUp && !fuTitle.trim()) {
      toast.error(t('crm.tasks.errors.titleRequired'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result: result.trim() || null, follow_up: followUp ? { title: fuTitle.trim(), due_at: fuDue } : undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as { task?: TaskRow; followUp?: TaskRow | null; error?: string };
      if (!res.ok && res.status !== 207) {
        toast.error(data.error === 'not_open' ? t('crm.tasks.errors.notOpen') : t('crm.tasks.errors.completeFailed'));
        return;
      }
      if (res.status === 207) toast.error(t('crm.tasks.errors.followUpFailed'));
      toast.success(data.followUp ? t('crm.tasks.toast.completedWithFollowUp') : t('crm.tasks.toast.completed'));
      onCompleted(data.task!, data.followUp ?? null);
      notifyCrmChanged();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!task} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('crm.tasks.complete.title')}</DialogTitle>
          <DialogDescription className="line-clamp-2">{task?.title}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-1.5">
            <label htmlFor={resultId} className="text-sm font-medium">
              {t('crm.tasks.complete.result')}
            </label>
            <Textarea
              id={resultId}
              value={result}
              onChange={(e) => setResult(e.target.value)}
              placeholder={t('crm.tasks.complete.resultPlaceholder')}
              maxLength={5000}
              rows={3}
              autoFocus
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} />
            {t('crm.tasks.complete.followUp')}
          </label>
          {followUp && (
            <div className="grid gap-3 rounded-lg border border-border p-3">
              <div className="grid gap-1.5">
                <label htmlFor={fuTitleId} className="text-sm font-medium">
                  {t('crm.tasks.fields.title')}
                </label>
                <Input id={fuTitleId} value={fuTitle} onChange={(e) => setFuTitle(e.target.value)} maxLength={300} required />
              </div>
              <DueField value={fuDue} onChange={setFuDue} />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('crm.common.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {t('crm.tasks.complete.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

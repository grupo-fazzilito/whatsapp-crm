'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Paperclip, X } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { uploadFile } from '@/lib/storage/client';
import { TICKET_CATEGORIES, TICKET_PRIORITIES } from '@/lib/support/input';

const selectCls = 'h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function CreateTicketDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('technical');
  const [priority, setPriority] = useState('normal');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setSubject('');
    setBody('');
    setFiles([]);
    setCategory('technical');
    setPriority('normal');
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const attachments = [];
      for (const f of files) {
        const up = await uploadFile('attachments', f, { folder: 'support' });
        attachments.push({ path: up.path, name: f.name, type: f.type || 'application/octet-stream' });
      }
      const res = await fetch('/api/support/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, category, priority, body, attachments }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const key = `support.errors.${data.error ?? 'generic'}`;
        const msg = t(key);
        setError(msg === key ? t('support.errors.generic') : msg);
        return;
      }
      toast.success(t('support.form.created', { n: data.ticket.number }));
      reset();
      onOpenChange(false);
      router.push(`/support?ticket=${data.ticket.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('support.errors.generic'));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t('support.form.title')}</DialogTitle>
            <DialogDescription>{t('support.form.description')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="tk-subject">{t('support.form.subject')}</Label>
            <Input id="tk-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} required minLength={3} placeholder={t('support.form.subjectPlaceholder')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="tk-category">{t('support.form.category')}</Label>
              <select id="tk-category" className={selectCls} value={category} onChange={(e) => setCategory(e.target.value)}>
                {TICKET_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`support.category.${c}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tk-priority">{t('support.form.priority')}</Label>
              <select id="tk-priority" className={selectCls} value={priority} onChange={(e) => setPriority(e.target.value)}>
                {TICKET_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {t(`support.priority.${p}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="tk-body">{t('support.form.body')}</Label>
            <Textarea id="tk-body" value={body} onChange={(e) => setBody(e.target.value)} rows={6} maxLength={10000} required placeholder={t('support.form.bodyPlaceholder')} />
          </div>
          <div className="grid gap-2">
            <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground focus-within:ring-2 focus-within:ring-ring">
              <Paperclip className="size-4" aria-hidden />
              {t('support.form.attach')}
              <input
                type="file"
                multiple
                accept="image/*,application/pdf,video/*"
                className="sr-only"
                onChange={(e) => setFiles((f) => [...f, ...Array.from(e.target.files ?? [])].slice(0, 5))}
              />
            </label>
            {files.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs">
                    {f.name}
                    <button type="button" aria-label={`${t('common.remove')} ${f.name}`} onClick={() => setFiles((x) => x.filter((_, k) => k !== i))} className="rounded-full p-0.5 hover:bg-background">
                      <X className="size-3" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={sending}>
              {sending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {sending ? t('support.form.sending') : t('support.form.send')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

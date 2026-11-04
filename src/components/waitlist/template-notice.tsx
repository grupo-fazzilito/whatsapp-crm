'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Clock, Loader2, Send } from 'lucide-react';
import { useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { Button } from '@/components/ui/button';

interface TemplateState {
  template: { id: string; status: string; rejection_reason: string | null } | null;
  whatsapp: boolean;
}

/**
 * State of the "Notificar llegada de stock" template, with "Send to Meta"
 * while it isn't approved. `context = 'store'`: shown under the "Notify me"
 * switch (nothing once approved); `'module'`: the Waitlist page.
 */
export function WaitlistTemplateNotice({ context }: { context: 'store' | 'module' }) {
  const t = useT();
  const { can } = useWorkspace();
  const [state, setState] = useState<TemplateState | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/waitlist/template', { cache: 'no-store' }).catch(() => null);
    if (res?.ok) setState((await res.json()) as TemplateState);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
    void load();
  }, [load]);

  if (!state?.template) return null;
  const { template: tpl, whatsapp } = state;
  if (tpl.status === 'Approved') {
    if (context === 'store') return null;
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />
        {t('waitlist.template.title')}: {t('waitlist.template.approved')}
      </p>
    );
  }

  const submit = async () => {
    setSending(true);
    const res = await fetch(`/api/whatsapp/templates/${tpl.id}/submit`, { method: 'POST' }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setSending(false);
    if (res?.ok && body?.submitted) toast.success(t('waitlist.template.submitted'));
    else toast.error(typeof body?.error === 'string' && body.error.length < 200 ? body.error : t('waitlist.error'));
    void load();
  };

  const pending = tpl.status === 'Pending';
  const rejected = tpl.status === 'Rejected';
  const text = pending
    ? t('waitlist.template.pending')
    : rejected
      ? t('waitlist.template.rejected', { reason: tpl.rejection_reason ?? '—' })
      : context === 'store'
        ? t('waitlist.template.needed')
        : t('waitlist.template.draft');
  const tone = pending ? 'border-sky-500/40 bg-sky-500/10 text-sky-900 dark:text-sky-100' : 'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100';

  return (
    <div role="status" className={`space-y-2 rounded-lg border p-3 text-sm ${tone}`}>
      <p className="flex items-start gap-2 font-medium">
        {pending ? <Clock className="mt-0.5 size-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />}
        <span>
          {t('waitlist.template.title')}
          <span className="block font-normal">{text}</span>
        </span>
      </p>
      {context === 'module' && !pending && <p className="pl-6 text-xs opacity-90">{t('waitlist.template.why')}</p>}
      <div className="flex flex-wrap items-center gap-2 pl-6">
        {!pending && can('admin') && (
          <Button type="button" size="sm" disabled={sending || !whatsapp} onClick={() => void submit()}>
            {sending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
            {t('waitlist.template.submit')}
          </Button>
        )}
        <Link href={`/settings/templates/${tpl.id}`} className="text-xs font-medium underline underline-offset-2">
          {t('waitlist.template.open')}
        </Link>
        {!pending && !whatsapp && <span className="w-full text-xs">{t('waitlist.template.noWhatsApp')}</span>}
      </div>
    </div>
  );
}

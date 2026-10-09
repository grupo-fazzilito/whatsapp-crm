'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Plus, Send } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { CreateTicketDialog } from './create-ticket-dialog';
import { STATUS_CLS, TicketThread, type ThreadMessage } from './ticket-thread';

interface Ticket {
  id: string;
  number: number;
  subject: string;
  category: string;
  priority: string;
  status: string;
  last_message_at: string;
}

export function SupportTickets() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const search = useSearchParams();
  const selected = search.get('ticket');
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [detail, setDetail] = useState<{ ticket: Ticket; messages: ThreadMessage[] } | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const fmt = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-PE', { dateStyle: 'medium' });

  const loadList = useCallback(async () => {
    const r = await fetch('/api/support/tickets', { cache: 'no-store' }).catch(() => null);
    setTickets(r?.ok ? ((await r.json()).tickets as Ticket[]) : []);
  }, []);
  const loadDetail = useCallback(async (id: string) => {
    const r = await fetch(`/api/support/tickets/${id}`, { cache: 'no-store' }).catch(() => null);
    setDetail(r?.ok ? await r.json() : null);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void loadList();
  }, [loadList, creating]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load the selected ticket
    if (selected) void loadDetail(selected);
    else setDetail(null);
  }, [selected, loadDetail]);

  const open = (id: string | null) => router.replace(id ? `/support?ticket=${id}` : '/support', { scroll: false });

  const send = async () => {
    if (!detail || !reply.trim()) return;
    setBusy(true);
    const r = await fetch(`/api/support/tickets/${detail.ticket.id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: reply }) });
    setBusy(false);
    if (!r.ok) return toast.error(t('support.errors.generic'));
    setDetail(await r.json());
    setReply('');
    void loadList();
  };

  const close = async () => {
    if (!detail) return;
    const r = await fetch(`/api/support/tickets/${detail.ticket.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'closed' }) });
    if (r.ok) {
      setDetail(await r.json());
      void loadList();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('support.page.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('support.page.subtitle')}</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden /> {t('support.page.new')}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <section className={cn('rounded-xl border border-border', selected && 'hidden lg:block')} aria-label={t('support.myTickets')}>
          {tickets === null ? (
            <div className="flex justify-center py-10">
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={t('common.loading')} />
            </div>
          ) : tickets.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">{t('support.page.empty')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {tickets.map((tk) => (
                <li key={tk.id}>
                  <button
                    type="button"
                    onClick={() => open(tk.id)}
                    aria-current={selected === tk.id}
                    className={cn('flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', selected === tk.id && 'bg-muted')}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">#{tk.number} · {fmt.format(new Date(tk.last_message_at))}</span>
                      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS_CLS[tk.status])}>{t(`support.status.${tk.status}`)}</span>
                    </span>
                    <span className="line-clamp-1 text-sm font-medium text-foreground">{tk.subject}</span>
                    <span className="text-xs text-muted-foreground">{t(`support.category.${tk.category}`)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={cn('rounded-xl border border-border p-4', !selected && 'hidden lg:block')}>
          {!detail ? (
            <p className="text-sm text-muted-foreground">{selected ? t('common.loading') : t('support.page.select')}</p>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <button type="button" onClick={() => open(null)} className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground lg:hidden">
                    <ArrowLeft className="size-3.5" aria-hidden /> {t('support.page.back')}
                  </button>
                  <h2 className="text-base font-semibold text-foreground">
                    #{detail.ticket.number} · {detail.ticket.subject}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {t(`support.category.${detail.ticket.category}`)} · {t(`support.priority.${detail.ticket.priority}`)}
                  </p>
                </div>
                <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', STATUS_CLS[detail.ticket.status])}>{t(`support.status.${detail.ticket.status}`)}</span>
              </div>
              <TicketThread messages={detail.messages} side="customer" labels={{ customer: t('support.page.you'), support: t('support.page.team') }} locale={locale} />
              {detail.ticket.status === 'closed' && <p className="text-xs text-muted-foreground">{t('support.page.closed')}</p>}
              <div className="grid gap-2 border-t border-border pt-4">
                <label htmlFor="tk-reply" className="sr-only">
                  {t('support.page.reply')}
                </label>
                <Textarea id="tk-reply" rows={3} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={10000} placeholder={t('support.page.replyPlaceholder')} />
                <div className="flex justify-end gap-2">
                  {detail.ticket.status !== 'closed' && (
                    <Button variant="outline" onClick={close}>
                      {t('support.page.close')}
                    </Button>
                  )}
                  <Button onClick={send} disabled={busy || !reply.trim()}>
                    {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
                    {t('support.page.send')}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
      <CreateTicketDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

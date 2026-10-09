'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeftRight, Bot, Coins, Loader2, RotateCcw, Search, Send, UserRound } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { OutboundContent } from '@/lib/channels/types';
import { renderForChannel, type PreviewChannel } from '@/lib/agents/render';
import { AgentBubble, CustomerBubble, SKINS } from './channel-preview';
import type { AiAgent } from './types';

const CHANNELS: PreviewChannel[] = ['whatsapp', 'instagram', 'messenger', 'webchat'];

type Turn =
  | { role: 'user'; text: string }
  | {
      role: 'assistant';
      reply: string;
      messages: OutboundContent[];
      handover: boolean;
      transferTo: { id: string; name: string } | null;
      catalogSearch: string | null;
    };

interface Credits {
  cost: number;
  balance: number | null;
}

export function AgentTestChat({ agent }: { agent: AiAgent }) {
  const { t, locale } = useI18n();
  const [channel, setChannel] = useState<PreviewChannel>('whatsapp');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noCredits, setNoCredits] = useState(false);
  const [credits, setCredits] = useState<Credits | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const nf = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-PE');

  useEffect(() => {
    let alive = true;
    fetch('/api/billing/status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { balance?: number; playground_cost?: number; enforce?: boolean } | null) => {
        if (!alive || !d) return;
        setCredits({ cost: d.playground_cost ?? 1, balance: d.balance ?? null });
        if (d.enforce !== false && typeof d.balance === 'number' && d.balance < (d.playground_cost ?? 1)) setNoCredits(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [turns, busy, channel]);

  const send = async () => {
    const message = text.trim();
    if (!message || busy) return;
    const next: Turn[] = [...turns, { role: 'user', text: message }];
    setTurns(next);
    setText('');
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agent.id}/playground`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          draft,
          turns: next.map((x) => (x.role === 'user' ? { role: 'user', content: x.text } : { role: 'assistant', content: x.reply || '…' })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setNoCredits(true);
        setTurns(turns);
        setText(message);
        return;
      }
      if (!res.ok) {
        setError(body.code === 'llm_unavailable' ? t('agents.test.noProvider') : t('agents.test.error'));
        setTurns(turns);
        setText(message);
        return;
      }
      setTurns([
        ...next,
        {
          role: 'assistant',
          reply: body.reply ?? '',
          messages: (body.messages ?? []) as OutboundContent[],
          handover: !!body.handover,
          transferTo: body.transferTo ?? null,
          catalogSearch: body.catalogSearch ?? null,
        },
      ]);
      setDraft(body.draft ?? {});
      if (body.credits) setCredits(body.credits as Credits);
    } catch {
      setError(t('agents.test.error'));
      setTurns(turns);
      setText(message);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setTurns([]);
    setDraft({});
    setError(null);
  };

  const skin = SKINS[channel];
  const note = t(`agents.test.note${channel.charAt(0).toUpperCase()}${channel.slice(1)}`);
  const rendered = useMemo(
    () => turns.map((turn) => (turn.role === 'assistant' ? renderForChannel(channel, turn.messages) : null)),
    [turns, channel],
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <div role="tablist" aria-label={t('agents.test.channel')} className="grid grid-cols-4 gap-1 rounded-lg border border-border bg-muted/40 p-1">
          {CHANNELS.map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={channel === c}
              onClick={() => setChannel(c)}
              className={cn(
                'rounded-md px-2 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                channel === c ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {SKINS[c].label}
            </button>
          ))}
        </div>

        {/* Phone-like frame */}
        <div className="flex h-[620px] flex-col overflow-hidden rounded-[28px] border-[6px] border-neutral-900 bg-neutral-900 shadow-xl dark:border-neutral-700">
          <div className={cn('flex items-center gap-3 px-4 py-3', skin.header)}>
            <span className="flex size-9 items-center justify-center rounded-full bg-white/20 text-current" aria-hidden>
              <Bot className={cn('size-5', skin.headerText)} />
            </span>
            <div className="min-w-0">
              <p className={cn('truncate text-sm font-semibold', skin.headerText)}>{agent.name}</p>
              <p className={cn('text-xs opacity-80', skin.headerText)}>{busy ? t('agents.test.thinking') : t('agents.test.online')}</p>
            </div>
          </div>

          <div ref={scroller} className={cn('flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-4', skin.area)} aria-live="polite">
            {turns.length === 0 && <p className="mx-auto mt-6 max-w-[80%] rounded-lg bg-white/80 px-3 py-2 text-center text-xs text-neutral-600 dark:bg-black/40 dark:text-neutral-300">{t('agents.test.empty')}</p>}
            {turns.map((turn, i) =>
              turn.role === 'user' ? (
                <CustomerBubble key={i} text={turn.text} channel={channel} />
              ) : (
                <div key={i} className="flex flex-col items-start gap-1.5">
                  {rendered[i]?.map((b, k) => <AgentBubble key={k} bubble={b} channel={channel} viewOptions={t('agents.test.viewOptions')} />)}
                  {turn.handover && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">
                      <UserRound className="size-3" aria-hidden /> {t('agents.test.handover')}
                    </span>
                  )}
                  {turn.transferTo && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-medium text-sky-900 dark:bg-sky-500/20 dark:text-sky-200">
                      <ArrowLeftRight className="size-3" aria-hidden /> {t('agents.test.transfer', { name: turn.transferTo.name })}
                    </span>
                  )}
                </div>
              ),
            )}
            {busy && (
              <div className={cn('inline-flex w-fit items-center gap-1 px-3 py-2', skin.theirs, skin.rounded)} aria-label={t('agents.test.thinking')}>
                <span className="size-1.5 animate-bounce rounded-full bg-current opacity-60 [animation-delay:-0.2s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-current opacity-60 [animation-delay:-0.1s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-current opacity-60" />
              </div>
            )}
          </div>

          <form
            className="flex items-center gap-2 border-t border-black/10 bg-white px-3 py-2 dark:border-white/10 dark:bg-neutral-900"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label htmlFor="agent-test-input" className="sr-only">
              {t('agents.test.placeholder')}
            </label>
            <input
              id="agent-test-input"
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 2000))}
              placeholder={t('agents.test.placeholder')}
              disabled={busy || noCredits}
              autoComplete="off"
              className="h-10 flex-1 rounded-full bg-neutral-100 px-4 text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 dark:bg-neutral-800 dark:text-white"
            />
            <Button type="submit" size="icon" className="size-10 rounded-full" disabled={busy || noCredits || !text.trim()} aria-label={t('agents.test.send')}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
            </Button>
          </form>
        </div>
      </div>

      <aside className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">{t('agents.test.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('agents.test.description')}</p>
        </div>
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{note}</p>
        {credits && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Coins className="size-4 shrink-0 text-primary" aria-hidden />
            {t('agents.test.cost', { cost: credits.cost, balance: credits.balance === null ? '—' : nf.format(credits.balance) })}
          </p>
        )}
        {noCredits && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {t('agents.test.noCredits')}
            <Link href="/settings?tab=billing" className="font-semibold underline underline-offset-2">
              {t('agents.test.topup')}
            </Link>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {turns.some((x) => x.role === 'assistant' && x.catalogSearch) && (
          <ul className="grid gap-1 text-xs text-muted-foreground">
            {turns.map((x, i) =>
              x.role === 'assistant' && x.catalogSearch ? (
                <li key={i} className="flex items-center gap-1.5">
                  <Search className="size-3" aria-hidden /> {t('agents.test.searched', { q: x.catalogSearch })}
                </li>
              ) : null,
            )}
          </ul>
        )}
        {Object.keys(draft).length > 0 && (
          <div className="rounded-lg border border-border p-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('agents.test.booking')}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
              {Object.entries(draft)
                .filter(([, v]) => v !== null && v !== '' && typeof v !== 'object')
                .map(([k, v]) => (
                  <Fragment2 key={k} k={k} v={String(v)} />
                ))}
            </dl>
          </div>
        )}
        <Button variant="outline" onClick={reset} disabled={busy || turns.length === 0} className="w-fit">
          <RotateCcw className="size-4" aria-hidden />
          {t('agents.test.reset')}
        </Button>
      </aside>
    </div>
  );
}

function Fragment2({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{k.replace(/_/g, ' ')}</dt>
      <dd className="truncate text-foreground">{v}</dd>
    </>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRightLeft, Bot, CalendarCheck, Hand, Loader2, RotateCcw, Send, TriangleAlert } from 'lucide-react';
import { useT } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import type { AiAgent } from './types';

/** Booking draft as returned by POST /api/agents/[id]/playground. */
interface Draft {
  service_id?: string | null;
  staff_id?: string | null;
  product_id?: string | null;
  date?: string | null;
  time?: string | null;
  customer_name?: string | null;
  party_size?: number | null;
  fields?: Record<string, string | number | null>;
}

interface PreviewResult {
  reply: string;
  intent: string;
  handover: boolean;
  transferTo: { id: string; name: string } | null;
  bookingAction: string;
  draft: Draft;
  draftLabels: { service: string | null; staff: string | null };
}

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  agentName?: string;
  result?: PreviewResult;
  error?: string;
}

interface Props {
  agent: AiAgent;
  /** Open the playground on another agent, keeping the conversation (transfers). */
  onSwitchAgent: (agentId: string) => AiAgent | null;
  onClose: () => void;
}

export function AgentPlayground({ agent: initialAgent, onSwitchAgent, onClose }: Props) {
  const t = useT();
  const [agent, setAgent] = useState(initialAgent);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState<Draft>({});
  const [draftLabels, setDraftLabels] = useState<PreviewResult['draftLabels']>({ service: null, staff: null });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, busy]);

  const run = async (history: Turn[], who: AiAgent) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/agents/${who.id}/playground`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          turns: history.filter((x) => !x.error).map(({ role, content }) => ({ role, content })),
          draft,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          data?.code === 'llm_unavailable' ? t('routing.playground.llmUnavailable') : t('routing.playground.error', { reason: data?.error ?? `HTTP ${res.status}` });
        setTurns([...history, { role: 'assistant', content: '', error: msg }]);
        return;
      }
      const result = data as PreviewResult;
      setDraft(result.draft ?? {});
      setDraftLabels(result.draftLabels ?? { service: null, staff: null });
      setTurns([...history, { role: 'assistant', content: result.reply, agentName: who.name, result }]);
    } catch (err) {
      setTurns([...history, { role: 'assistant', content: '', error: t('routing.playground.error', { reason: err instanceof Error ? err.message : 'network' }) }]);
    } finally {
      setBusy(false);
    }
  };

  const send = (e?: React.FormEvent) => {
    e?.preventDefault();
    const content = text.trim();
    if (!content || busy) return;
    setText('');
    const history = [...turns, { role: 'user' as const, content }];
    setTurns(history);
    void run(history, agent);
  };

  // Like production: the target agent answers the same customer message.
  const continueWith = (targetId: string) => {
    const target = onSwitchAgent(targetId);
    if (!target) return;
    setAgent(target);
    const history = turns.slice(0, -1);
    setTurns(history);
    void run(history, target);
  };

  const reset = () => {
    setTurns([]);
    setDraft({});
    setDraftLabels({ service: null, staff: null });
  };

  const draftEntries = (
    [
      ['service', draftLabels.service ?? draft.service_id],
      ['staff', draftLabels.staff ?? draft.staff_id],
      ['date', draft.date],
      ['time', draft.time],
      ['customer_name', draft.customer_name],
      ['party_size', draft.party_size],
    ] as const
  ).filter(([, v]) => v !== null && v !== undefined && v !== '');
  const extraFields = Object.entries(draft.fields ?? {}).filter(([, v]) => v !== null && v !== '');

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full! flex-col gap-0 sm:max-w-lg!">
        <SheetHeader className="border-b border-border">
          <SheetTitle className="flex items-center gap-2">
            <Bot className="size-4 text-primary" />
            {t('routing.playground.title', { name: agent.name })}
          </SheetTitle>
          <SheetDescription>{t('routing.playground.description')}</SheetDescription>
          {!agent.enabled && (
            <p className="flex items-start gap-1.5 rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              {t('routing.playground.disabledNote')}
            </p>
          )}
        </SheetHeader>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
          {turns.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">{t('routing.playground.empty')}</p>}
          {turns.map((turn, i) =>
            turn.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
                  <span className="sr-only">{t('routing.playground.you')}: </span>
                  {turn.content}
                </div>
              </div>
            ) : turn.error ? (
              <p key={i} role="alert" className="flex items-start gap-1.5 rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                {turn.error}
              </p>
            ) : (
              <div key={i} className="flex flex-col items-start gap-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">{turn.agentName}</span>
                {turn.content && (
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm text-foreground">{turn.content}</div>
                )}
                {turn.result && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="text-[11px]">
                      {t('routing.playground.intent')}: {turn.result.intent}
                    </Badge>
                    {turn.result.transferTo && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-700 dark:text-violet-300">
                        <ArrowRightLeft className="size-3" />
                        {t('routing.playground.transferWould', { name: turn.result.transferTo.name })}
                      </span>
                    )}
                    {turn.result.handover && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                        <Hand className="size-3" />
                        {t('routing.playground.handoverWould')}
                      </span>
                    )}
                    {turn.result.bookingAction === 'confirm' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-300">
                        <CalendarCheck className="size-3" />
                        {t('routing.playground.bookingConfirm')}
                      </span>
                    )}
                    {turn.result.bookingAction === 'cancel' && (
                      <Badge variant="outline" className="text-[11px]">
                        {t('routing.playground.bookingCancel')}
                      </Badge>
                    )}
                  </div>
                )}
                {turn.result?.transferTo && i === turns.length - 1 && !busy && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => continueWith(turn.result!.transferTo!.id)}>
                    <ArrowRightLeft className="size-3.5" />
                    {t('routing.playground.continueWith', { name: turn.result.transferTo.name })}
                  </Button>
                )}
              </div>
            ),
          )}
          {busy && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {t('routing.playground.thinking')}
            </p>
          )}
        </div>

        {(draftEntries.length > 0 || extraFields.length > 0) && (
          <div className="border-t border-border bg-muted/30 px-4 py-2.5">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-foreground">
              <CalendarCheck className="size-3.5 text-primary" />
              {t('routing.playground.booking')}
            </p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
              {draftEntries.map(([k, v]) => (
                <div key={k} className="flex gap-1.5">
                  <dt className="text-muted-foreground">{t(`routing.playground.field.${k}`)}:</dt>
                  <dd className="truncate text-foreground">{String(v)}</dd>
                </div>
              ))}
              {extraFields.map(([k, v]) => (
                <div key={k} className="flex gap-1.5">
                  <dt className="text-muted-foreground">{k}:</dt>
                  <dd className="truncate text-foreground">{String(v)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        <form onSubmit={send} className="flex items-end gap-2 border-t border-border p-3">
          <Button type="button" variant="ghost" size="icon" onClick={reset} disabled={busy || turns.length === 0} aria-label={t('routing.playground.reset')} title={t('routing.playground.reset')}>
            <RotateCcw className="size-4" />
          </Button>
          <Textarea
            rows={1}
            value={text}
            maxLength={2000}
            placeholder={t('routing.playground.placeholder')}
            aria-label={t('routing.playground.placeholder')}
            className={cn('max-h-32 min-h-9 flex-1 resize-none')}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <Button type="submit" size="icon" disabled={busy || !text.trim()} aria-label={t('routing.playground.send')}>
            <Send className="size-4" />
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

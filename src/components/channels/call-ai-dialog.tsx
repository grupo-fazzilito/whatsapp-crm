'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AI_SCHEDULES,
  AI_VOICES,
  CALL_ANSWER_MODES,
  DEFAULT_CALL_AI,
  FALLBACK_SECONDS,
  GREETING_MAX,
  MAX_MINUTES,
  type AiHoursRange,
  type CallAiConfig,
} from '@/lib/calls/ai-config';

interface Data {
  ai: CallAiConfig;
  block: 'no_service' | 'no_key' | 'no_agent' | 'no_tokens' | null;
  agents: { id: string; name: string; enabled: boolean }[];
  minute_cost: number;
}

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60';

/** Days in the order people read a week: Monday first (0 = Sunday). */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

/** Who answers a WhatsApp number's calls: the team, the AI, by schedule, or the AI when nobody answers. */
export function CallAiDialog({
  channelId,
  open,
  onOpenChange,
  onSaved,
}: {
  channelId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (ai: CallAiConfig) => void;
}) {
  const t = useT();
  const [data, setData] = useState<Data | null>(null);
  const [draft, setDraft] = useState<CallAiConfig>(DEFAULT_CALL_AI);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setFailed(false);
    fetch(`/api/channels/${channelId}/calling`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as Data;
      })
      .then((d) => {
        if (!alive) return;
        setData(d);
        setDraft(d.ai);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [open, channelId]);

  const set = <K extends keyof CallAiConfig>(k: K, v: CallAiConfig[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const usesAi = draft.mode !== 'humans';
  const missingAgent = usesAi && !draft.agent_id;

  const setRange = (i: number, patch: Partial<AiHoursRange>) =>
    set('custom_hours', draft.custom_hours.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/channels/${channelId}/calling`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai: draft }),
      });
      const body = (await res.json().catch(() => ({}))) as { ai?: CallAiConfig; block?: Data['block'] };
      if (!res.ok || !body.ai) throw new Error();
      setDraft(body.ai);
      onSaved?.(body.ai);
      setData((d) => (d ? { ...d, ai: body.ai!, block: body.block ?? null } : d));
      if (body.block) toast.warning(t(`calls.ai.block.${body.block}`));
      else toast.success(t('calls.settings.saved'));
      if (!body.block) onOpenChange(false);
    } catch {
      toast.error(t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('calls.ai.title')}</DialogTitle>
          <DialogDescription>{t('calls.ai.description')}</DialogDescription>
        </DialogHeader>

        {failed ? (
          <p className="text-sm text-red-600 dark:text-red-400">{t('common.error')}</p>
        ) : !data ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={t('common.loading')} />
        ) : (
          <div className="grid gap-5">
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium text-foreground">{t('calls.ai.modeLabel')}</legend>
              {CALL_ANSWER_MODES.map((m) => (
                <label key={m} className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-2.5 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <input type="radio" name="call-ai-mode" className="mt-0.5 size-4 accent-primary" checked={draft.mode === m} onChange={() => set('mode', m)} />
                  <span className="text-sm">
                    <span className="font-medium text-foreground">{t(`calls.ai.mode.${m}`)}</span>
                    <span className="block text-xs text-muted-foreground">{t(`calls.ai.modeHelp.${m}`)}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {usesAi && (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="call-ai-agent">{t('calls.ai.agent')}</Label>
                  {data.agents.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{t('calls.ai.noAgents')}</p>
                  ) : (
                    <select id="call-ai-agent" className={selectClass} value={draft.agent_id ?? ''} onChange={(e) => set('agent_id', e.target.value || null)} aria-invalid={missingAgent}>
                      <option value="">{t('calls.ai.pickAgent')}</option>
                      {data.agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.enabled ? a.name : t('calls.ai.agentOff', { name: a.name })}
                        </option>
                      ))}
                    </select>
                  )}
                  <p className="text-xs text-muted-foreground">{t('calls.ai.agentHelp')}</p>
                </div>

                {draft.mode === 'schedule' && (
                  <div className="grid gap-2">
                    <Label htmlFor="call-ai-schedule">{t('calls.ai.scheduleLabel')}</Label>
                    <select id="call-ai-schedule" className={selectClass} value={draft.schedule} onChange={(e) => set('schedule', e.target.value as CallAiConfig['schedule'])}>
                      {AI_SCHEDULES.map((s) => (
                        <option key={s} value={s}>
                          {t(`calls.ai.schedule.${s}`)}
                        </option>
                      ))}
                    </select>
                    {draft.schedule === 'custom' && (
                      <div className="grid gap-2 rounded-md border border-border p-2.5">
                        {draft.custom_hours.length === 0 && <p className="text-xs text-muted-foreground">{t('calls.ai.noHours')}</p>}
                        {draft.custom_hours.map((r, i) => (
                          <div key={i} className="flex flex-wrap items-center gap-2">
                            <select aria-label={t('calls.ai.day')} className={`${selectClass} w-auto min-w-28 flex-1`} value={r.day} onChange={(e) => setRange(i, { day: Number(e.target.value) })}>
                              {WEEK.map((d) => (
                                <option key={d} value={d}>
                                  {t(`calls.ai.days.${d}`)}
                                </option>
                              ))}
                            </select>
                            <Input type="time" aria-label={t('calls.ai.from')} className="h-9 w-28" value={r.from} onChange={(e) => setRange(i, { from: e.target.value })} />
                            <span className="text-xs text-muted-foreground" aria-hidden>
                              –
                            </span>
                            <Input type="time" aria-label={t('calls.ai.to')} className="h-9 w-28" value={r.to} onChange={(e) => setRange(i, { to: e.target.value })} />
                            <Button type="button" variant="ghost" size="icon" aria-label={t('calls.ai.removeHours')} onClick={() => set('custom_hours', draft.custom_hours.filter((_, j) => j !== i))}>
                              <Trash2 className="size-4" aria-hidden />
                            </Button>
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="justify-self-start"
                          onClick={() => set('custom_hours', [...draft.custom_hours, { day: 1, from: '09:00', to: '18:00' }])}
                        >
                          <Plus className="size-4" aria-hidden /> {t('calls.ai.addHours')}
                        </Button>
                        <p className="text-xs text-muted-foreground">{t('calls.ai.hoursHelp')}</p>
                      </div>
                    )}
                  </div>
                )}

                {draft.mode === 'fallback' && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="call-ai-wait">{t('calls.ai.fallbackSeconds')}</Label>
                    <Input
                      id="call-ai-wait"
                      type="number"
                      inputMode="numeric"
                      min={FALLBACK_SECONDS.min}
                      max={FALLBACK_SECONDS.max}
                      className="w-28"
                      value={draft.fallback_seconds}
                      onChange={(e) => set('fallback_seconds', Number(e.target.value))}
                    />
                    <p className="text-xs text-muted-foreground">{t('calls.ai.fallbackHelp', { min: FALLBACK_SECONDS.min, max: FALLBACK_SECONDS.max })}</p>
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="call-ai-voice">{t('calls.ai.voice')}</Label>
                    <select id="call-ai-voice" className={selectClass} value={draft.voice} onChange={(e) => set('voice', e.target.value as CallAiConfig['voice'])}>
                      {AI_VOICES.map((v) => (
                        <option key={v} value={v}>
                          {v.charAt(0).toUpperCase() + v.slice(1)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="call-ai-max">{t('calls.ai.maxMinutes')}</Label>
                    <Input
                      id="call-ai-max"
                      type="number"
                      inputMode="numeric"
                      min={MAX_MINUTES.min}
                      max={MAX_MINUTES.max}
                      value={draft.max_minutes}
                      onChange={(e) => set('max_minutes', Number(e.target.value))}
                    />
                  </div>
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="call-ai-greeting">{t('calls.ai.greeting')}</Label>
                  <Textarea
                    id="call-ai-greeting"
                    rows={2}
                    maxLength={GREETING_MAX}
                    placeholder={t('calls.ai.greetingPlaceholder')}
                    value={draft.greeting}
                    onChange={(e) => set('greeting', e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">{t('calls.ai.greetingHelp')}</p>
                </div>

                <ul className="grid list-disc gap-1 rounded-md bg-muted/50 p-3 pl-7 text-xs text-muted-foreground">
                  <li>{t('calls.ai.noteCost', { n: data.minute_cost })}</li>
                  <li>{t('calls.ai.noteTools')}</li>
                  <li>{t('calls.ai.noteHuman')}</li>
                  <li>{t('calls.ai.noteTranscript')}</li>
                  <li>{t('calls.ai.noteFallback')}</li>
                </ul>

                {data.block && data.block !== 'no_agent' && (
                  <p role="status" className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
                    {t(`calls.ai.block.${data.block}`)}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={!data || saving || missingAgent}>
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

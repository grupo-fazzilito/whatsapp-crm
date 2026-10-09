'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Lightbulb, Loader2, Save } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { AiAgent } from './types';

export const MAX_TRAINING = 5000;

/** Training context of an agent (≤ 5,000 characters). */
export function AgentTraining({
  agent,
  readOnly,
  placeholder,
  onSaved,
}: {
  agent: AiAgent;
  readOnly: boolean;
  placeholder?: string;
  onSaved: (agent: AiAgent) => void;
}) {
  const { t, locale } = useI18n();
  const initial = agent.training_context ?? '';
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const nf = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-PE');
  const over = value.length > MAX_TRAINING;
  const dirty = value !== initial;

  const save = async () => {
    if (over || readOnly) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/agents/${agent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ training_context: value.trim() ? value : null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      onSaved(body.agent as AiAgent);
      toast.success(t('agents.training.saved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-3">
        <div>
          <label htmlFor="agent-training" className="text-base font-semibold text-foreground">
            {t('agents.training.title')}
          </label>
          <p id="agent-training-help" className="mt-1 text-sm text-muted-foreground">
            {t('agents.training.description')}
          </p>
        </div>
        <Textarea
          id="agent-training"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder || t('agents.training.placeholder')}
          readOnly={readOnly}
          rows={18}
          aria-describedby="agent-training-help agent-training-count"
          aria-invalid={over}
          className={cn('min-h-[380px] resize-y font-[inherit] leading-relaxed', over && 'border-destructive focus-visible:ring-destructive')}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p id="agent-training-count" className={cn('text-xs tabular-nums', over ? 'font-semibold text-destructive' : 'text-muted-foreground')} aria-live="polite">
            {over ? t('agents.training.tooLong', { max: nf.format(MAX_TRAINING) }) : t('agents.training.counter', { n: nf.format(value.length), max: nf.format(MAX_TRAINING) })}
          </p>
          {!readOnly && (
            <div className="flex items-center gap-3">
              {dirty && <span className="text-xs text-muted-foreground">{t('agents.training.unsaved')}</span>}
              <Button onClick={save} disabled={saving || over || !dirty}>
                {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
                {t('agents.training.save')}
              </Button>
            </div>
          )}
        </div>
      </div>
      <aside className="flex flex-col gap-3 rounded-xl border border-border bg-muted/30 p-4 text-sm">
        <p className="flex items-center gap-2 font-semibold text-foreground">
          <Lightbulb className="size-4 text-primary" aria-hidden /> {t('agents.training.tips')}
        </p>
        <ul className="grid list-disc gap-2 pl-5 text-muted-foreground">
          <li>{t('agents.training.tip1')}</li>
          <li>{t('agents.training.tip2')}</li>
          <li>{t('agents.training.tip3')}</li>
        </ul>
        <p className="border-t border-border pt-3 text-xs text-muted-foreground">{t('agents.training.alsoUses')}</p>
      </aside>
    </div>
  );
}

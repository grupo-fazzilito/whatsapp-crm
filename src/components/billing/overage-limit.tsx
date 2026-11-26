'use client';

import { useId } from 'react';
import { useI18n } from '@/i18n/client';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { OVERAGE_MAX_STEPS, OVERAGE_SLIDER_STEPS, formatUsdCents, overageCentsFor, type SubscriptionPricing } from '@/lib/billing/subscription-pricing';

/**
 * Most extra credits a month once the plan's run out: a slider in credits
 * (1,000–9,000) with the most it can cost on top, plus a field for more.
 */
export function OverageLimit({
  pricing,
  value,
  onChange,
  disabled = false,
  tone = 'app',
}: {
  pricing: SubscriptionPricing;
  value: number;
  onChange: (credits: number) => void;
  disabled?: boolean;
  /** Colors of the public site or of the app. */
  tone?: 'app' | 'marketing';
}) {
  const { t, locale } = useI18n();
  const id = useId();
  const nf = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-PE');
  const step = pricing.step_tokens;
  const steps = Math.max(1, Math.round(value / step));
  const muted = tone === 'marketing' ? 'text-[var(--m-text-tertiary)]' : 'text-muted-foreground';
  const strong = tone === 'marketing' ? 'text-[var(--m-text-heading)]' : 'text-foreground';
  const max = formatUsdCents(overageCentsFor(steps * step, pricing));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label htmlFor={id} className={cn('text-sm font-medium', strong)}>
          {t('subscription.overage.label')}
        </label>
        <p className={cn('text-right', strong)} aria-live="polite">
          <span className="text-2xl font-bold">{max}</span> <span className={cn('text-sm', muted)}>{t('subscription.overage.atMost')}</span>
        </p>
      </div>
      <input
        id={id}
        type="range"
        min={1}
        max={OVERAGE_SLIDER_STEPS}
        step={1}
        value={Math.min(steps, OVERAGE_SLIDER_STEPS)}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value) * step)}
        aria-valuetext={t('subscription.overage.valueText', { n: nf.format(steps * step), price: max })}
        className="h-2 w-full cursor-pointer accent-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
      />
      <div className={cn('flex justify-between text-xs', muted)}>
        <span>{nf.format(step)}</span>
        <span>{nf.format(OVERAGE_SLIDER_STEPS * step)}</span>
      </div>
      <p className={cn('text-sm', strong)}>{t('subscription.overage.credits', { n: nf.format(steps * step) })}</p>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-more`} className={cn('text-xs', muted)}>
          {t('subscription.overage.more')}
        </label>
        <Input
          id={`${id}-more`}
          type="number"
          inputMode="numeric"
          min={step}
          max={OVERAGE_MAX_STEPS * step}
          step={step}
          disabled={disabled}
          value={steps * step}
          onChange={(e) => {
            const n = Math.round(Number(e.target.value) / step);
            if (Number.isFinite(n)) onChange(Math.min(OVERAGE_MAX_STEPS, Math.max(1, n)) * step);
          }}
          className="h-8 w-32"
        />
      </div>
      <p className={cn('text-xs', muted)}>
        {t('subscription.overage.help', { price: formatUsdCents(Math.round(pricing.step_price * 100)), n: nf.format(step) })}
      </p>
    </div>
  );
}

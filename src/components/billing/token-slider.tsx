'use client';

import { useId } from 'react';
import { useI18n } from '@/i18n/client';
import { cn } from '@/lib/utils';
import { formatUsdCents, monthlyCents, type SubscriptionPricing } from '@/lib/billing/subscription-pricing';

/**
 * Pick how many AI tokens a month (steps of 1,000) and see the monthly price.
 * Used on the public pricing page and in Settings → Tokens.
 */
export function TokenSlider({
  pricing,
  value,
  onChange,
  className,
  tone = 'app',
}: {
  pricing: SubscriptionPricing;
  value: number;
  onChange: (tokens: number) => void;
  className?: string;
  /** Colors of the public site or of the app. */
  tone?: 'app' | 'marketing';
}) {
  const { t, locale } = useI18n();
  const id = useId();
  const nf = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-PE');
  const steps = Math.round(pricing.max_tokens / pricing.step_tokens);
  const step = Math.min(steps, Math.max(1, Math.round(value / pricing.step_tokens)));
  const cents = monthlyCents(step * pricing.step_tokens, pricing);
  const muted = tone === 'marketing' ? 'text-[var(--m-text-tertiary)]' : 'text-muted-foreground';
  const strong = tone === 'marketing' ? 'text-[var(--m-text-heading)]' : 'text-foreground';

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label htmlFor={id} className={cn('text-sm font-medium', strong)}>
          {t('subscription.slider.label')}
        </label>
        <p className={cn('text-right', strong)} aria-live="polite">
          <span className="text-2xl font-bold">{nf.format(step * pricing.step_tokens)}</span>{' '}
          <span className={cn('text-sm', muted)}>{t('subscription.slider.perMonth')}</span>
        </p>
      </div>
      <input
        id={id}
        type="range"
        min={1}
        max={steps}
        step={1}
        value={step}
        onChange={(e) => onChange(Number(e.target.value) * pricing.step_tokens)}
        aria-valuetext={t('subscription.slider.valueText', { n: nf.format(step * pricing.step_tokens), price: formatUsdCents(cents) })}
        className="h-2 w-full cursor-pointer accent-emerald-500"
      />
      <div className={cn('flex justify-between text-xs', muted)}>
        <span>{nf.format(pricing.step_tokens)}</span>
        <span>{nf.format(pricing.max_tokens)}</span>
      </div>
      <div className={cn('flex flex-wrap items-baseline justify-between gap-2 rounded-lg border p-3', tone === 'marketing' ? 'border-[var(--m-border-primary)]' : 'border-border')}>
        <span className={cn('text-sm', muted)}>{t('subscription.slider.price')}</span>
        <span className={cn('text-xl font-bold', strong)}>
          {formatUsdCents(cents)} <span className={cn('text-sm font-normal', muted)}>{t('subscription.slider.month')}</span>
        </span>
      </div>
      <p className={cn('text-xs', muted)}>
        {t('subscription.slider.formula', {
          base: formatUsdCents(Math.round(pricing.base_price * 100)),
          first: nf.format(pricing.step_tokens),
          step: formatUsdCents(Math.round(pricing.step_price * 100)),
        })}
      </p>
    </div>
  );
}

import type { Translator } from '@/i18n/translate';

/** API error code → translated sentence (falls back to a generic message + the code). */
export function apiErrorText(t: Translator, code: unknown): string {
  const c = String(code ?? 'unknown');
  const key = `portals.apiErrors.${c}`;
  const text = t(key);
  return text === key ? t('portals.apiErrors.generic', { code: c }) : text;
}

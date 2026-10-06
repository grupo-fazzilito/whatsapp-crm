'use client';

import { useT } from '@/i18n/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { selectClass } from './channel-types';

export interface WebchatForm {
  title: string;
  color: string;
  greeting: string;
  position: 'right' | 'left';
  origins: string;
  prechat: ('name' | 'email' | 'phone')[];
}

export const DEFAULT_WEBCHAT_FORM: WebchatForm = {
  title: '',
  color: '#10b981',
  greeting: '',
  position: 'right',
  origins: '',
  prechat: ['name'],
};

export function webchatFormFromSettings(settings: Record<string, unknown>): WebchatForm {
  return {
    title: (settings.title as string) ?? '',
    color: (settings.color as string) ?? '#10b981',
    greeting: (settings.greeting as string) ?? '',
    position: settings.position === 'left' ? 'left' : 'right',
    origins: ((settings.allowed_origins as string[]) ?? []).join('\n'),
    prechat: ((settings.prechat_fields as WebchatForm['prechat']) ?? []).slice(),
  };
}

export function webchatSettingsPayload(form: WebchatForm) {
  return {
    title: form.title,
    color: form.color,
    greeting: form.greeting,
    position: form.position,
    allowed_origins: form.origins
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean),
    prechat_fields: form.prechat,
  };
}

const PRECHAT = ['name', 'email', 'phone'] as const;

export function WebchatSettingsFields({
  value,
  onChange,
  disabled,
}: {
  value: WebchatForm;
  onChange: (next: WebchatForm) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const set = <K extends keyof WebchatForm>(k: K, v: WebchatForm[K]) => onChange({ ...value, [k]: v });

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="grid gap-1.5">
          <Label htmlFor="wc-title">{t('channels.webchat.title')}</Label>
          <Input
            id="wc-title"
            value={value.title}
            maxLength={60}
            disabled={disabled}
            placeholder={t('channels.webchat.titlePlaceholder')}
            onChange={(e) => set('title', e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="wc-color">{t('channels.webchat.color')}</Label>
          <div className="flex items-center gap-2">
            <input
              id="wc-color"
              type="color"
              value={value.color}
              disabled={disabled}
              onChange={(e) => set('color', e.target.value)}
              className="h-9 w-12 cursor-pointer rounded-md border border-input bg-background p-1"
            />
            <span className="font-mono text-xs text-muted-foreground">{value.color}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="wc-greeting">{t('channels.webchat.greeting')}</Label>
        <Textarea
          id="wc-greeting"
          rows={2}
          maxLength={500}
          value={value.greeting}
          disabled={disabled}
          placeholder={t('channels.webchat.greetingPlaceholder')}
          onChange={(e) => set('greeting', e.target.value)}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="wc-position">{t('channels.webchat.position')}</Label>
        <select
          id="wc-position"
          className={selectClass}
          value={value.position}
          disabled={disabled}
          onChange={(e) => set('position', e.target.value as 'right' | 'left')}
        >
          <option value="right">{t('channels.webchat.positionRight')}</option>
          <option value="left">{t('channels.webchat.positionLeft')}</option>
        </select>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="wc-origins">{t('channels.webchat.origins')}</Label>
        <Textarea
          id="wc-origins"
          rows={2}
          value={value.origins}
          disabled={disabled}
          placeholder="https://www.minegocio.com"
          className="font-mono text-xs"
          onChange={(e) => set('origins', e.target.value)}
        />
        <p className="text-xs text-muted-foreground">{t('channels.webchat.originsHelp')}</p>
      </div>

      <fieldset className="grid gap-1.5">
        <legend className="mb-1 text-sm font-medium">{t('channels.webchat.prechat')}</legend>
        <div className="flex flex-wrap gap-4">
          {PRECHAT.map((f) => (
            <label key={f} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                disabled={disabled}
                checked={value.prechat.includes(f)}
                onChange={(e) =>
                  set('prechat', e.target.checked ? [...value.prechat, f] : value.prechat.filter((x) => x !== f))
                }
              />
              {t(`channels.webchat.field.${f}`)}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t('channels.webchat.prechatHelp')}</p>
      </fieldset>
    </div>
  );
}

'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Save } from 'lucide-react';
import { useI18n, useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { createClient } from '@/lib/supabase/client';
import { COUNTRIES } from '@/lib/workspace/countries';
import type { Workspace } from '@/lib/workspace/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { invalidateAi, selectClass, trimOrNull } from '../shared';

export const CURRENCIES = [
  'MXN', 'COP', 'ARS', 'CLP', 'PEN', 'USD', 'EUR', 'GTQ', 'CRC', 'DOP', 'UYU', 'BOB', 'PYG', 'HNL', 'NIO', 'BRL', 'CAD', 'INR',
] as const;

function timeZones(): string[] {
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
    const list = intl.supportedValuesOf?.('timeZone');
    if (list?.length) return list;
  } catch {
    /* older engines */
  }
  return Array.from(new Set(COUNTRIES.map((c) => c.timezone)));
}

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

type ProfileDraft = {
  name: string;
  business_type_detail: string;
  description: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  city: string;
  state: string;
  postal_code: string;
  google_map_link: string;
  country: string;
  currency: string;
  timezone: string;
  locale: 'es' | 'en';
};

function toDraft(w: Workspace): ProfileDraft {
  return {
    name: w.name ?? '',
    business_type_detail: w.business_type_detail ?? '',
    description: w.description ?? '',
    phone: w.phone ?? '',
    email: w.email ?? '',
    website: w.website ?? '',
    address: w.address ?? '',
    city: w.city ?? '',
    state: w.state ?? '',
    postal_code: w.postal_code ?? '',
    google_map_link: w.google_map_link ?? '',
    country: w.country ?? '',
    currency: w.currency || 'USD',
    // A workspace still on the DB default gets the browser's zone proposed.
    timezone: w.timezone && w.timezone !== 'UTC' ? w.timezone : browserZone(),
    locale: w.locale === 'en' ? 'en' : 'es',
  };
}

export function ProfileForm({ workspace, readOnly }: { workspace: Workspace; readOnly: boolean }) {
  const t = useT();
  const { locale } = useI18n();
  const { refresh } = useWorkspace();
  const [draft, setDraft] = useState<ProfileDraft>(() => toDraft(workspace));
  const [saving, setSaving] = useState(false);
  const zones = useMemo(() => timeZones(), []);
  const set = <K extends keyof ProfileDraft>(k: K, v: ProfileDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const currencies = useMemo(() => {
    const list: string[] = [...CURRENCIES];
    if (draft.currency && !list.includes(draft.currency)) list.unshift(draft.currency);
    return list;
  }, [draft.currency]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    if (!draft.name.trim()) {
      toast.error(t('business.setup.profile.nameRequired'));
      return;
    }
    let tz = draft.timezone.trim();
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
    } catch {
      toast.error(t('business.setup.profile.invalidTimezone'));
      return;
    }
    if (!tz) tz = 'UTC';
    setSaving(true);
    const { error } = await createClient()
      .from('workspaces')
      .update({
        name: draft.name.trim(),
        business_type_detail: trimOrNull(draft.business_type_detail),
        description: trimOrNull(draft.description),
        phone: trimOrNull(draft.phone),
        email: trimOrNull(draft.email),
        website: trimOrNull(draft.website),
        address: trimOrNull(draft.address),
        city: trimOrNull(draft.city),
        state: trimOrNull(draft.state),
        postal_code: trimOrNull(draft.postal_code),
        google_map_link: trimOrNull(draft.google_map_link),
        country: trimOrNull(draft.country),
        currency: draft.currency,
        timezone: tz,
        locale: draft.locale,
      })
      .eq('id', workspace.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await invalidateAi();
    await refresh();
    toast.success(t('business.common.saved'));
  };

  const field = (k: keyof ProfileDraft, labelKey: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`bp-${k}`}>{t(labelKey)}</Label>
      <Input
        id={`bp-${k}`}
        value={draft[k]}
        disabled={readOnly}
        onChange={(e) => set(k, e.target.value as never)}
        {...props}
      />
    </div>
  );

  return (
    <form onSubmit={submit} className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('business.setup.profile.title')}</CardTitle>
          <CardDescription>{t('business.setup.profile.description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {field('name', 'business.setup.profile.name', { required: true, maxLength: 120 })}
          {field('business_type_detail', 'business.setup.profile.typeDetail', {
            placeholder: t('business.setup.profile.typeDetailPlaceholder'),
            maxLength: 120,
          })}
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="bp-description">{t('business.setup.profile.aboutLabel')}</Label>
            <Textarea
              id="bp-description"
              rows={4}
              value={draft.description}
              disabled={readOnly}
              maxLength={2000}
              placeholder={t('business.setup.profile.aboutPlaceholder')}
              onChange={(e) => set('description', e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('business.setup.profile.aboutHint')}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('business.setup.profile.contactTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {field('phone', 'business.setup.profile.phone', { type: 'tel', maxLength: 40 })}
          {field('email', 'business.setup.profile.email', { type: 'email', maxLength: 160 })}
          {field('website', 'business.setup.profile.website', { type: 'url', placeholder: 'https://', maxLength: 300 })}
          {field('google_map_link', 'business.setup.profile.mapLink', { type: 'url', placeholder: 'https://maps.google.com/…', maxLength: 500 })}
          <div className="sm:col-span-2">{field('address', 'business.setup.profile.address', { maxLength: 300 })}</div>
          {field('city', 'business.setup.profile.city', { maxLength: 120 })}
          {field('state', 'business.setup.profile.state', { maxLength: 120 })}
          {field('postal_code', 'business.setup.profile.postalCode', { maxLength: 20 })}
          <div className="grid gap-1.5">
            <Label htmlFor="bp-country">{t('business.setup.profile.country')}</Label>
            <select id="bp-country" className={selectClass} value={draft.country} disabled={readOnly} onChange={(e) => set('country', e.target.value)}>
              <option value="">—</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name[locale]}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('business.setup.profile.regionTitle')}</CardTitle>
          <CardDescription>{t('business.setup.profile.regionDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="bp-currency">{t('business.setup.profile.currency')}</Label>
            <select id="bp-currency" className={selectClass} value={draft.currency} disabled={readOnly} onChange={(e) => set('currency', e.target.value)}>
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bp-timezone">{t('business.setup.profile.timezone')}</Label>
            <Input
              id="bp-timezone"
              list="bp-timezones"
              value={draft.timezone}
              disabled={readOnly}
              onChange={(e) => set('timezone', e.target.value)}
            />
            <datalist id="bp-timezones">
              {zones.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bp-locale">{t('business.setup.profile.locale')}</Label>
            <select
              id="bp-locale"
              className={selectClass}
              value={draft.locale}
              disabled={readOnly}
              onChange={(e) => set('locale', e.target.value as 'es' | 'en')}
            >
              <option value="es">Español</option>
              <option value="en">English</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {!readOnly && (
        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {t('business.common.save')}
          </Button>
        </div>
      )}
    </form>
  );
}

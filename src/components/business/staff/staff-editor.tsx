'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { api } from '../api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { DAYS, selectClass, trimOrNull, type Service, type Staff, type StaffException, type StaffSlot } from '../shared';
import { WeeklyAvailability } from './weekly-availability';
import { StaffExceptions } from './staff-exceptions';

export interface MemberOption {
  user_id: string;
  name: string;
}

export interface StaffDraft {
  name: string;
  title: string;
  qualification: string;
  experience: string;
  fee: string;
  languages: string;
  photo_url: string;
  bio: string;
  email: string;
  phone: string;
  is_active: boolean;
  member_user_id: string;
  available_days: string[];
  available_start_time: string;
  available_end_time: string;
  weekly_slots: Record<string, StaffSlot[]>;
  date_exceptions: StaffException[];
}

function toDraft(s: Staff | null): StaffDraft {
  return {
    name: s?.name ?? '',
    title: s?.title ?? '',
    qualification: s?.qualification ?? '',
    experience: s?.experience ?? '',
    fee: s?.fee ? String(s.fee) : '',
    languages: s?.languages ?? '',
    photo_url: s?.photo_url ?? '',
    bio: s?.bio ?? '',
    email: s?.email ?? '',
    phone: s?.phone ?? '',
    is_active: s?.is_active ?? true,
    member_user_id: s?.member_user_id ?? '',
    available_days: s?.available_days ?? ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    available_start_time: s?.available_start_time ?? '09:00',
    available_end_time: s?.available_end_time ?? '18:00',
    weekly_slots: s?.weekly_slots ?? {},
    date_exceptions: s?.date_exceptions ?? [],
  };
}

interface Props {
  staff: Staff | null;
  readOnly: boolean;
  services: Service[];
  members: MemberOption[];
  linkedServiceIds: string[];
  onClose: () => void;
  onSaved: () => void;
}

export function StaffEditor({ staff, readOnly, services, members, linkedServiceIds, onClose, onSaved }: Props) {
  const t = useT();
  const { workspace, label, modules } = useWorkspace();
  const [draft, setDraft] = useState<StaffDraft>(() => toDraft(staff));
  const [serviceIds, setServiceIds] = useState<string[]>(linkedServiceIds);
  const [tab, setTab] = useState('profile');
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof StaffDraft>(k: K, v: StaffDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const staffNoun = label('staff');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly || !workspace) return;
    if (!draft.name.trim()) {
      setTab('profile');
      toast.error(t('business.staff.nameRequired'));
      return;
    }
    if (draft.available_end_time <= draft.available_start_time) {
      setTab('availability');
      toast.error(t('business.staff.invalidShift'));
      return;
    }
    setSaving(true);
    // Drop empty days from the fixed-slot map.
    const weekly = Object.fromEntries(Object.entries(draft.weekly_slots).filter(([, v]) => v.length > 0));
    const row = {
      name: draft.name.trim(),
      title: trimOrNull(draft.title),
      qualification: trimOrNull(draft.qualification),
      experience: trimOrNull(draft.experience),
      fee: Number(draft.fee) > 0 ? Number(draft.fee) : 0,
      languages: trimOrNull(draft.languages),
      photo_url: trimOrNull(draft.photo_url),
      bio: trimOrNull(draft.bio),
      email: trimOrNull(draft.email),
      phone: trimOrNull(draft.phone),
      is_active: draft.is_active,
      member_user_id: draft.member_user_id || null,
      available_days: DAYS.filter((d) => draft.available_days.includes(d)),
      available_start_time: draft.available_start_time,
      available_end_time: draft.available_end_time,
      weekly_slots: weekly,
      date_exceptions: [...draft.date_exceptions].sort((a, b) => a.date.localeCompare(b.date)),
      // Linked services are replaced only when the services module is on.
      ...(modules.services ? { service_ids: serviceIds } : {}),
    };
    try {
      // The server drops the AI's cached business context.
      if (staff) await api(`/api/business/staff/${staff.id}`, { method: 'PATCH', body: row });
      else await api('/api/business/staff', { method: 'POST', body: row });
    } catch (err) {
      setSaving(false);
      toast.error(err instanceof Error ? err.message : t('business.common.error'));
      return;
    }

    setSaving(false);
    toast.success(t('business.common.saved'));
    onSaved();
  };

  const field = (k: keyof StaffDraft, labelKey: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`st-${k}`}>{t(labelKey)}</Label>
      <Input
        id={`st-${k}`}
        value={draft[k] as string}
        disabled={readOnly}
        onChange={(e) => set(k, e.target.value as never)}
        {...props}
      />
    </div>
  );

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full! overflow-y-auto sm:max-w-2xl!">
        <form onSubmit={submit} className="flex min-h-full flex-col">
          <SheetHeader>
            <SheetTitle>
              {staff
                ? readOnly
                  ? staff.name
                  : t('business.common.editItem', { item: staff.name })
                : t('business.common.newItem', { item: staffNoun.toLowerCase() })}
            </SheetTitle>
            <SheetDescription>{t('business.staff.editorDescription')}</SheetDescription>
          </SheetHeader>

          <div className="flex-1 px-4 pb-4">
            <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
              <TabsList className="w-full overflow-x-auto">
                <TabsTrigger value="profile">{t('business.staff.tab.profile')}</TabsTrigger>
                <TabsTrigger value="availability">{t('business.staff.tab.availability')}</TabsTrigger>
                <TabsTrigger value="exceptions">{t('business.staff.tab.exceptions')}</TabsTrigger>
                {modules.services && <TabsTrigger value="services">{label('servicePlural')}</TabsTrigger>}
              </TabsList>

              <TabsContent value="profile" className="grid gap-4 pt-3 sm:grid-cols-2">
                {field('name', 'business.staff.field.name', { required: true, maxLength: 120 })}
                {field('title', 'business.staff.field.title', { maxLength: 120, placeholder: t('business.staff.field.titlePlaceholder') })}
                {field('phone', 'business.staff.field.phone', { type: 'tel', maxLength: 40 })}
                {field('email', 'business.staff.field.email', { type: 'email', maxLength: 160 })}
                {field('qualification', 'business.staff.field.qualification', { maxLength: 200 })}
                {field('experience', 'business.staff.field.experience', { maxLength: 120 })}
                {field('fee', 'business.staff.field.fee', { type: 'number', min: 0, step: 'any' })}
                {field('languages', 'business.staff.field.languages', { maxLength: 200, placeholder: t('business.staff.field.languagesPlaceholder') })}
                <div className="sm:col-span-2">{field('photo_url', 'business.staff.field.photo', { type: 'url', placeholder: 'https://' })}</div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="st-bio">{t('business.staff.field.bio')}</Label>
                  <Textarea
                    id="st-bio"
                    rows={3}
                    maxLength={1000}
                    value={draft.bio}
                    disabled={readOnly}
                    onChange={(e) => set('bio', e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">{t('business.staff.field.bioHint')}</p>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="st-member">{t('business.staff.field.member')}</Label>
                  <select
                    id="st-member"
                    className={selectClass}
                    value={draft.member_user_id}
                    disabled={readOnly}
                    onChange={(e) => set('member_user_id', e.target.value)}
                  >
                    <option value="">{t('business.staff.field.noMember')}</option>
                    {members.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">{t('business.staff.field.memberHint')}</p>
                </div>
                <label className="flex items-center justify-between gap-3 self-start rounded-lg border border-border p-3">
                  <span className="text-sm font-medium text-foreground">{t('business.staff.field.active')}</span>
                  <Switch checked={draft.is_active} disabled={readOnly} onCheckedChange={(v) => set('is_active', v)} />
                </label>
              </TabsContent>

              <TabsContent value="availability" className="pt-3">
                <WeeklyAvailability draft={draft} readOnly={readOnly} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
              </TabsContent>

              <TabsContent value="exceptions" className="pt-3">
                <StaffExceptions
                  value={draft.date_exceptions}
                  readOnly={readOnly}
                  onChange={(date_exceptions) => set('date_exceptions', date_exceptions)}
                />
              </TabsContent>

              {modules.services && (
                <TabsContent value="services" className="pt-3">
                  <p className="mb-3 text-sm text-muted-foreground">
                    {t('business.staff.servicesHint', { services: label('servicePlural').toLowerCase() })}
                  </p>
                  {services.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('business.staff.noServices')}</p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {services.map((s) => {
                        const checked = serviceIds.includes(s.id);
                        return (
                          <label key={s.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                            <input
                              type="checkbox"
                              className="size-4 accent-primary"
                              checked={checked}
                              disabled={readOnly}
                              onChange={(e) =>
                                setServiceIds((ids) => (e.target.checked ? [...ids, s.id] : ids.filter((x) => x !== s.id)))
                              }
                            />
                            <span className="truncate text-foreground">{s.name}</span>
                            {!s.is_active && <span className="text-xs text-muted-foreground">({t('business.common.inactive')})</span>}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </TabsContent>
              )}
            </Tabs>
          </div>

          <SheetFooter className="sticky bottom-0 flex-row justify-end gap-2 border-t border-border bg-popover">
            <Button type="button" variant="outline" onClick={onClose}>
              {readOnly ? t('business.common.close') : t('business.common.cancel')}
            </Button>
            {!readOnly && (
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                {t('business.common.save')}
              </Button>
            )}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

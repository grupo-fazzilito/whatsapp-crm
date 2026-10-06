'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Pencil, Plus, Search, Trash2, UserRound } from 'lucide-react';
import { useI18n, useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/workspace/countries';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { cn } from '@/lib/utils';
import { moneyLocale, EmptyState, LoadingBlock, Notice, PageHeader, invalidateAi, type Service, type Staff } from '../shared';
import { useDayLabel } from '../setup/hours-form';
import { StaffEditor, type MemberOption } from './staff-editor';

export function StaffManager() {
  const t = useT();
  const { locale } = useI18n();
  const { workspace, can, label, modules } = useWorkspace();
  const isAdmin = can('admin');
  const dayLabel = useDayLabel();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [links, setLinks] = useState<{ staff_id: string; service_id: string }[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Staff | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Staff | null>(null);

  const load = useCallback(async () => {
    const db = createClient();
    try {
      const [st, sv, ln] = await Promise.all([
        db.from('staff').select('*').order('name'),
        db.from('services').select('*').order('name'),
        db.from('staff_services').select('staff_id, service_id'),
      ]);
      if (st.error) toast.error(st.error.message);
      setStaff((st.data as Staff[]) ?? []);
      setServices((sv.data as Service[]) ?? []);
      setLinks(ln.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!workspace) return;
    load();
    fetch('/api/workspaces/members', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d) =>
        setMembers(
          (d.members ?? []).map((m: { user_id: string; profile?: { full_name: string | null; email: string } | null }) => ({
            user_id: m.user_id,
            name: m.profile?.full_name || m.profile?.email || m.user_id,
          })),
        ),
      )
      .catch(() => undefined);
  }, [workspace, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter((s) => [s.name, s.title, s.email, s.phone].some((v) => v?.toLowerCase().includes(q)));
  }, [staff, query]);

  const toggleActive = async (s: Staff, is_active: boolean) => {
    setStaff((list) => list.map((x) => (x.id === s.id ? { ...x, is_active } : x)));
    const { error } = await createClient().from('staff').update({ is_active }).eq('id', s.id);
    if (error) {
      toast.error(error.message);
      load();
      return;
    }
    invalidateAi();
  };

  const remove = async () => {
    if (!deleting) return;
    const { error } = await createClient().from('staff').delete().eq('id', deleting.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t('business.common.deleted'));
    invalidateAi();
    load();
  };

  const serviceNames = (id: string) =>
    links
      .filter((l) => l.staff_id === id)
      .map((l) => services.find((s) => s.id === l.service_id)?.name)
      .filter(Boolean) as string[];

  const staffNoun = label('staff');
  const staffPlural = label('staffPlural');

  return (
    <div className="space-y-6">
      <PageHeader
        title={staffPlural}
        description={t('business.staff.description', { staff: staffPlural.toLowerCase() })}
        actions={
          isAdmin && (
            <Button onClick={() => setEditing(null)}>
              <Plus className="size-4" />
              {t('business.common.newItem', { item: staffNoun.toLowerCase() })}
            </Button>
          )
        }
      />
      {!isAdmin && <Notice>{t('business.common.readOnly')}</Notice>}
      {!modules.staff && <Notice>{t('business.common.moduleOff', { module: staffPlural })}</Notice>}

      {loading ? (
        <LoadingBlock />
      ) : staff.length === 0 ? (
        <EmptyState
          icon={<UserRound className="size-6" />}
          title={t('business.staff.emptyTitle', { staff: staffPlural.toLowerCase() })}
          description={t('business.staff.emptyDescription')}
          action={
            isAdmin && (
              <Button onClick={() => setEditing(null)}>
                <Plus className="size-4" />
                {t('business.common.newItem', { item: staffNoun.toLowerCase() })}
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder={t('business.common.search')}
              aria-label={t('business.common.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((s) => {
              const svc = serviceNames(s.id);
              const fixedDays = Object.entries(s.weekly_slots ?? {}).filter(([, v]) => v?.length).length;
              return (
                <Card key={s.id} className={cn('flex flex-col', !s.is_active && 'opacity-70')}>
                  <CardContent className="flex flex-1 flex-col gap-3">
                    <div className="flex items-start gap-3">
                      {s.photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.photo_url} alt="" className="size-10 shrink-0 rounded-full object-cover" />
                      ) : (
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary" aria-hidden>
                          {s.name.charAt(0).toUpperCase()}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-semibold text-foreground">{s.name}</h3>
                        {s.title && <p className="truncate text-xs text-muted-foreground">{s.title}</p>}
                      </div>
                      <Switch
                        checked={s.is_active}
                        disabled={!isAdmin}
                        aria-label={t('business.common.active')}
                        onCheckedChange={(v) => toggleActive(s, v)}
                      />
                    </div>

                    <div className="grid gap-1 text-xs text-muted-foreground">
                      <span>
                        {(s.available_days ?? []).length
                          ? (s.available_days ?? []).map((d) => dayLabel(d).slice(0, 3)).join(' · ')
                          : t('business.staff.noDays')}
                      </span>
                      <span>
                        {fixedDays > 0
                          ? t('business.staff.fixedSlotsSummary', { days: fixedDays })
                          : `${s.available_start_time ?? '09:00'} – ${s.available_end_time ?? '18:00'}`}
                      </span>
                      {!!s.fee && s.fee > 0 && workspace && <span>{formatMoney(Number(s.fee), workspace.currency, moneyLocale(locale, workspace.country))}</span>}
                    </div>

                    {modules.services && svc.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {svc.slice(0, 4).map((n) => (
                          <Badge key={n} variant="secondary">
                            {n}
                          </Badge>
                        ))}
                        {svc.length > 4 && <Badge variant="outline">+{svc.length - 4}</Badge>}
                      </div>
                    )}

                    <div className="mt-auto flex justify-end gap-1 border-t border-border pt-3">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                        <Pencil className="size-3.5" />
                        {isAdmin ? t('business.common.edit') : t('business.common.view')}
                      </Button>
                      {isAdmin && (
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleting(s)}>
                          <Trash2 className="size-3.5" />
                          {t('business.common.delete')}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {editing !== undefined && (
        <StaffEditor
          staff={editing}
          readOnly={!isAdmin}
          services={services}
          members={members}
          linkedServiceIds={editing ? links.filter((l) => l.staff_id === editing.id).map((l) => l.service_id) : []}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            load();
          }}
        />
      )}

      <ConfirmationDialog
        isOpen={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('business.common.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('business.staff.deleteDescription')}
        confirmText={t('business.common.delete')}
        cancelText={t('business.common.cancel')}
        variant="destructive"
        onConfirm={remove}
      />
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { BriefcaseBusiness, Pencil, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import { useI18n, useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/workspace/countries';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { moneyLocale, EmptyState, LoadingBlock, Notice, PageHeader, invalidateAi, selectClass, type Service } from '../shared';
import { BulkImportDialog } from '../bulk-import-dialog';
import { ServiceEditor } from './service-editor';

export function ServicesManager() {
  const t = useT();
  const { locale } = useI18n();
  const { workspace, can, label, modules } = useWorkspace();
  const isAdmin = can('admin');
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [editing, setEditing] = useState<Service | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Service | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data, error } = await createClient().from('services').select('*').order('category', { nullsFirst: false }).order('name');
      if (error) toast.error(error.message);
      setServices((data as Service[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (workspace) load();
  }, [workspace, load]);

  const categories = useMemo(
    () => Array.from(new Set(services.map((s) => s.category).filter((c): c is string => !!c))).sort(),
    [services],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return services.filter(
      (s) =>
        (!category || s.category === category) &&
        (!q || s.name.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q)),
    );
  }, [services, query, category]);

  const price = (s: Service) => {
    if (!s.price || s.price <= 0 || !workspace) return t('business.services.noPrice');
    const amount = formatMoney(Number(s.price), workspace.currency, moneyLocale(locale, workspace.country));
    return s.price_is_from ? `${t('business.services.from')} ${amount}` : amount;
  };

  const toggleActive = async (s: Service, is_active: boolean) => {
    setServices((list) => list.map((x) => (x.id === s.id ? { ...x, is_active } : x)));
    const { error } = await createClient().from('services').update({ is_active }).eq('id', s.id);
    if (error) {
      toast.error(error.message);
      load();
      return;
    }
    invalidateAi();
  };

  const remove = async () => {
    if (!deleting) return;
    const { error } = await createClient().from('services').delete().eq('id', deleting.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t('business.common.deleted'));
    invalidateAi();
    load();
  };

  const noun = label('service');
  const plural = label('servicePlural');

  return (
    <div className="space-y-6">
      <PageHeader
        title={plural}
        description={t('business.services.description', { services: plural.toLowerCase() })}
        actions={
          isAdmin && (
            <>
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Sparkles className="size-4" />
                {t('business.import.button')}
              </Button>
              <Button onClick={() => setEditing(null)}>
                <Plus className="size-4" />
                {t('business.common.newItem', { item: noun.toLowerCase() })}
              </Button>
            </>
          )
        }
      />
      {!isAdmin && <Notice>{t('business.common.readOnly')}</Notice>}
      {!modules.services && <Notice>{t('business.common.moduleOff', { module: plural })}</Notice>}

      {loading ? (
        <LoadingBlock />
      ) : services.length === 0 ? (
        <EmptyState
          icon={<BriefcaseBusiness className="size-6" />}
          title={t('business.services.emptyTitle', { services: plural.toLowerCase() })}
          description={t('business.services.emptyDescription')}
          action={
            isAdmin && (
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="outline" onClick={() => setImportOpen(true)}>
                  <Sparkles className="size-4" />
                  {t('business.import.button')}
                </Button>
                <Button onClick={() => setEditing(null)}>
                  <Plus className="size-4" />
                  {t('business.common.newItem', { item: noun.toLowerCase() })}
                </Button>
              </div>
            )
          }
        />
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative max-w-sm flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder={t('business.common.search')}
                aria-label={t('business.common.search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {categories.length > 0 && (
              <select
                className={cn(selectClass, 'sm:w-56')}
                aria-label={t('business.services.field.category')}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">{t('business.services.allCategories')}</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('business.services.field.name')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('business.services.field.category')}</TableHead>
                  <TableHead>{t('business.services.field.price')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('business.services.field.duration')}</TableHead>
                  <TableHead>{t('business.common.active')}</TableHead>
                  <TableHead className="w-24 text-right">
                    <span className="sr-only">{t('business.common.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s) => (
                  <TableRow key={s.id} className={cn(!s.is_active && 'opacity-60')}>
                    <TableCell className="max-w-xs whitespace-normal">
                      <span className="block font-medium text-foreground">{s.name}</span>
                      {s.description && <span className="line-clamp-2 block text-xs text-muted-foreground">{s.description}</span>}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {s.category ? <Badge variant="secondary">{s.category}</Badge> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{price(s)}</TableCell>
                    <TableCell className="hidden whitespace-nowrap sm:table-cell">{s.duration_minutes ?? 30} min</TableCell>
                    <TableCell>
                      <Switch
                        checked={s.is_active}
                        disabled={!isAdmin}
                        aria-label={t('business.common.active')}
                        onCheckedChange={(v) => toggleActive(s, v)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon-sm" aria-label={t('business.common.edit')} onClick={() => setEditing(s)}>
                          <Pencil className="size-3.5" />
                        </Button>
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-destructive"
                            aria-label={t('business.common.delete')}
                            onClick={() => setDeleting(s)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      {t('business.common.noResults')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {editing !== undefined && (
        <ServiceEditor
          service={editing}
          categories={categories}
          readOnly={!isAdmin}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            load();
          }}
        />
      )}

      {isAdmin && <BulkImportDialog kind="services" open={importOpen} onOpenChange={setImportOpen} onImported={load} />}

      <ConfirmationDialog
        isOpen={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('business.common.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('business.services.deleteDescription')}
        confirmText={t('business.common.delete')}
        cancelText={t('business.common.cancel')}
        variant="destructive"
        onConfirm={remove}
      />
    </div>
  );
}

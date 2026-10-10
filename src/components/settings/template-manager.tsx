'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Eye, Loader2, Pencil, Plus, RefreshCw, Send, Sparkles, Trash2 } from 'lucide-react';
import { useWorkspace } from '@/hooks/use-workspace';
import { useI18n } from '@/i18n/client';
import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { TemplatePreview } from '@/components/templates/template-preview';
import { LANGUAGES, TEMPLATE_SUGGESTIONS, draftFromRow, submitErrorKey, type TemplateRow, type TemplateStatus } from '@/lib/templates/model';

type Filter = 'all' | TemplateStatus;
const FILTERS: Filter[] = ['all', 'Draft', 'Pending', 'Approved', 'Rejected'];
const STATUS_KEY: Record<TemplateStatus, string> = { Draft: 'draft', Pending: 'pending', Approved: 'approved', Rejected: 'rejected' };
const CATEGORY_KEY: Record<string, string> = { Marketing: 'marketing', Utility: 'utility', Authentication: 'authentication' };

const categoryColors: Record<string, string> = {
  Marketing: 'bg-emerald-600/20 text-emerald-400 border-emerald-600/30',
  Utility: 'bg-teal-600/20 text-teal-400 border-teal-600/30',
  Authentication: 'bg-amber-600/20 text-amber-400 border-amber-600/30',
};

const statusColors: Record<TemplateStatus, string> = {
  Draft: 'bg-slate-600/20 text-slate-400 border-slate-600/30',
  Pending: 'bg-yellow-600/20 text-yellow-400 border-yellow-600/30',
  Approved: 'bg-primary/20 text-primary border-primary/30',
  Rejected: 'bg-red-600/20 text-red-400 border-red-600/30',
};

const outlineBtn = 'border-slate-200 dark:border-slate-700 bg-transparent text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60';

export function TemplateManager() {
  const { workspace, loading: workspaceLoading, can } = useWorkspace();
  const { t, locale } = useI18n();
  const router = useRouter();
  const isAdmin = can('admin');
  const lang: 'es' | 'en' = locale === 'en' ? 'en' : 'es';

  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [syncing, setSyncing] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [preview, setPreview] = useState<TemplateRow | null>(null);
  const [toDelete, setToDelete] = useState<TemplateRow | null>(null);

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/templates', { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setTemplates((body.templates ?? []) as TemplateRow[]);
    } catch (err) {
      console.error('Failed to fetch templates:', err);
      toast.error(t('templates.list.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (workspaceLoading) return;
    if (!workspace) {
      setLoading(false);
      return;
    }
    void fetchTemplates();
  }, [workspaceLoading, workspace, fetchTemplates]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: templates.length, Draft: 0, Pending: 0, Approved: 0, Rejected: 0 };
    for (const tpl of templates) c[tpl.status ?? 'Draft'] += 1;
    return c;
  }, [templates]);
  const shown = filter === 'all' ? templates : templates.filter((x) => (x.status ?? 'Draft') === filter);

  const languageLabel = (code: string) => LANGUAGES.find((l) => l.code === code)?.label ?? code;

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch('/api/whatsapp/templates/sync', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      toast.success(t('templates.list.synced', { total: data.total ?? 0, inserted: data.inserted ?? 0, updated: data.updated ?? 0 }));
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        const names = data.errors
          .slice(0, 3)
          .map((e: { name: string; language: string }) => `${e.name} (${e.language})`)
          .join(', ');
        const more = data.errors.length > 3 ? ` +${data.errors.length - 3}` : '';
        toast.error(t('templates.list.syncPartial', { names: `${names}${more}` }));
      }
      if (data.truncated) toast.warning(t('templates.list.syncTruncated'));
      await fetchTemplates();
    } catch (err) {
      toast.error(t('templates.list.syncError'), { description: err instanceof Error ? err.message : undefined });
    } finally {
      setSyncing(false);
    }
  }

  async function handleSubmit(tpl: TemplateRow) {
    setSubmitting(tpl.id);
    try {
      const res = await fetch(`/api/whatsapp/templates/${tpl.id}/submit`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (res.status === 422) {
        toast.error(t('templates.list.submitInvalid'));
        router.push(`/settings/templates/${tpl.id}`);
        return;
      }
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      if (body.template) setTemplates((prev) => prev.map((x) => (x.id === tpl.id ? (body.template as TemplateRow) : x)));
      if (body.submitted) toast.success(t('templates.list.submitted'));
      else toast.error(t('templates.list.submitError'), { description: submitErrorKey(body.error) ? t(submitErrorKey(body.error)!) : body.error });
    } catch (err) {
      toast.error(t('templates.list.submitError'), { description: err instanceof Error ? err.message : undefined });
    } finally {
      setSubmitting(null);
    }
  }

  async function handleDelete(tpl: TemplateRow) {
    const res = await fetch(`/api/whatsapp/templates/${tpl.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(t('templates.list.deleteError'), { description: body?.error ?? `HTTP ${res.status}` });
      throw new Error('delete failed');
    }
    toast.success(t('templates.list.deleted'));
    setTemplates((prev) => prev.filter((x) => x.id !== tpl.id));
    if (preview?.id === tpl.id) setPreview(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-label={t('templates.loading')}>
        <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
      </div>
    );
  }

  const editable = (s: TemplateStatus) => s === 'Draft' || s === 'Rejected';

  const actions = (tpl: TemplateRow, inDialog = false) => {
    const status = tpl.status ?? 'Draft';
    if (!isAdmin) return null;
    return (
      <>
        {editable(status) && (
          <Link href={`/settings/templates/${tpl.id}`} className={cn(buttonVariants({ variant: 'outline', size: inDialog ? 'default' : 'sm' }), outlineBtn)}>
            <Pencil className="size-3.5" aria-hidden />
            {t('templates.list.edit')}
          </Link>
        )}
        {status === 'Draft' && (
          <Button size={inDialog ? 'default' : 'sm'} onClick={() => void handleSubmit(tpl)} disabled={submitting === tpl.id} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {submitting === tpl.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Send className="size-3.5" aria-hidden />}
            {t('templates.list.submit')}
          </Button>
        )}
        <Button
          variant="ghost"
          size={inDialog ? 'default' : 'icon-sm'}
          onClick={() => setToDelete(tpl)}
          aria-label={t('templates.list.deleteNamed', { name: tpl.name })}
          title={t('templates.list.delete')}
          className="text-slate-400 hover:bg-red-950/30 hover:text-red-400"
        >
          <Trash2 className="size-4" aria-hidden />
          {inDialog && t('templates.list.delete')}
        </Button>
      </>
    );
  };

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h2 className="text-lg font-semibold text-white">{t('templates.list.title')}</h2>
          <p className="text-sm text-slate-400">{t('templates.list.description')}</p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => void handleSync()} disabled={syncing} className={outlineBtn} title={t('templates.list.syncHint')}>
              <RefreshCw className={cn('size-4', syncing && 'animate-spin')} aria-hidden />
              {syncing ? t('templates.list.syncing') : t('templates.list.sync')}
            </Button>
            <Link href="/settings/templates/new" className={cn(buttonVariants(), 'bg-primary text-primary-foreground hover:bg-primary/90')}>
              <Plus className="size-4" aria-hidden />
              {t('templates.list.new')}
            </Link>
          </div>
        )}
      </div>

      {templates.length > 0 && (
        <div role="group" aria-label={t('templates.list.filterLabel')} className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                filter === f ? 'border-primary bg-primary/10 text-primary' : 'border-slate-800 text-slate-400 hover:bg-slate-800/40',
              )}
            >
              {f === 'all' ? t('templates.list.filterAll') : t(`templates.status.${STATUS_KEY[f]}`)} <span className="tabular-nums opacity-70">{counts[f]}</span>
            </button>
          ))}
        </div>
      )}

      {templates.length === 0 ? (
        <Card className="border-slate-800 bg-slate-900/40">
          <CardContent className="space-y-5 py-8">
            <div className="mx-auto max-w-xl text-center">
              <p className="font-medium text-slate-200">{t('templates.list.emptyTitle')}</p>
              <p className="mt-1 text-sm text-slate-400">{t('templates.list.emptyBody')}</p>
            </div>
            {isAdmin && (
              <div>
                <p className="mb-2 flex items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <Sparkles className="size-3.5 text-primary" aria-hidden /> {t('templates.list.suggestions')}
                </p>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {TEMPLATE_SUGGESTIONS.map((s) => (
                    <li key={s.id}>
                      <Link
                        href={`/settings/templates/new?suggestion=${s.id}`}
                        className="block h-full rounded-lg border border-slate-800 p-3 transition-colors hover:border-primary/50 hover:bg-slate-800/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-200">{s.title[lang]}</span>
                          <Badge className={cn('border text-[10px]', categoryColors[s.category])}>{t(`templates.category.${CATEGORY_KEY[s.category]}`)}</Badge>
                        </span>
                        {s.body[lang] && <span className="mt-1 line-clamp-2 block text-xs text-slate-400">{s.body[lang]}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex justify-center">
                  <Link href="/settings/templates/new" className={cn(buttonVariants({ variant: 'outline' }), outlineBtn)}>
                    <Plus className="size-4" aria-hidden />
                    {t('templates.list.startBlank')}
                  </Link>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : shown.length === 0 ? (
        <p className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-400">{t('templates.list.noneInFilter')}</p>
      ) : (
        <ul className="grid gap-3">
          {shown.map((tpl) => {
            const status = tpl.status ?? 'Draft';
            const d = draftFromRow(tpl);
            return (
              <li key={tpl.id}>
                <Card className="border-slate-800 bg-slate-900/40">
                  <CardContent className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-start sm:justify-between">
                    <button
                      type="button"
                      onClick={() => setPreview(tpl)}
                      className="min-w-0 flex-1 space-y-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={t('templates.list.previewNamed', { name: tpl.name })}
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="break-all font-medium text-slate-200">{tpl.name}</span>
                        <Badge className={cn('border text-xs', categoryColors[tpl.category] ?? '')}>{t(`templates.category.${CATEGORY_KEY[tpl.category] ?? 'marketing'}`)}</Badge>
                        <Badge className={cn('border text-xs', statusColors[status])}>{t(`templates.status.${STATUS_KEY[status]}`)}</Badge>
                        <span className="text-xs text-slate-400">{languageLabel(tpl.language)}</span>
                      </span>
                      <span className="line-clamp-2 block text-sm text-slate-400">{d.category === 'Authentication' ? t('templates.list.authBody') : d.body}</span>
                      {status === 'Rejected' && tpl.rejection_reason && (
                        <span className="block rounded-md border border-red-600/30 bg-red-600/10 px-2 py-1 text-xs text-red-500 dark:text-red-400">
                          {t('templates.list.rejectedReason', { reason: tpl.rejection_reason })}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 text-xs text-primary">
                        <Eye className="size-3.5" aria-hidden /> {t('templates.list.preview')}
                      </span>
                    </button>
                    {isAdmin && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions(tpl)}</div>}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="sm:max-w-md">
          {preview && (
            <>
              <DialogHeader>
                <DialogTitle className="break-all">{preview.name}</DialogTitle>
                <DialogDescription>
                  {t(`templates.category.${CATEGORY_KEY[preview.category] ?? 'marketing'}`)} · {languageLabel(preview.language)} · {t(`templates.status.${STATUS_KEY[preview.status ?? 'Draft']}`)}
                </DialogDescription>
              </DialogHeader>
              {preview.status === 'Rejected' && preview.rejection_reason && (
                <p role="status" className="rounded-md border border-red-600/30 bg-red-600/10 px-3 py-2 text-sm text-red-500 dark:text-red-400">
                  {t('templates.list.rejectedReason', { reason: preview.rejection_reason })}
                </p>
              )}
              <TemplatePreview draft={draftFromRow(preview)} />
              {isAdmin && <DialogFooter>{actions(preview, true)}</DialogFooter>}
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        isOpen={!!toDelete}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={t('templates.list.deleteTitle')}
        description={toDelete?.meta_template_id ? t('templates.list.deleteBodyMeta', { name: toDelete?.name ?? '' }) : t('templates.list.deleteBody', { name: toDelete?.name ?? '' })}
        confirmText={t('templates.list.delete')}
        cancelText={t('templates.cancel')}
        variant="destructive"
        onConfirm={() => (toDelete ? handleDelete(toDelete) : undefined)}
      />
    </div>
  );
}

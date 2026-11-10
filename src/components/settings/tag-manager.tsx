'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, X, Loader2, Sparkles } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { Tag } from '@/types';

const PRESET_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];

interface Draft {
  id: string | null;
  name: string;
  color: string;
  ai_hint: string;
}

const EMPTY: Draft = { id: null, name: '', color: PRESET_COLORS[3], ai_hint: '' };

export function TagManager() {
  const { t } = useI18n();
  const { workspace, loading: workspaceLoading, can } = useWorkspace();
  const isAdmin = can('admin');

  const [loading, setLoading] = useState(true);
  const [tags, setTags] = useState<Tag[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tagToDelete, setTagToDelete] = useState<Tag | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (workspaceLoading) return;
    if (!workspace) {
      setLoading(false);
      return;
    }
    fetchTags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceLoading, workspace?.id]);

  async function fetchTags() {
    try {
      setLoading(true);
      const res = await fetch('/api/tags', { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setTags(body.tags || []);
    } catch (err) {
      console.error('Failed to fetch tags:', err);
      toast.error(t('crm.tagManager.loadFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error(t('crm.tagManager.nameRequired'));
      return;
    }
    setSaving(true);
    try {
      const payload = { name: draft.name.trim(), color: draft.color, ai_hint: draft.ai_hint.trim() || null };
      const res = await fetch(draft.id ? `/api/tags/${draft.id}` : '/api/tags', {
        method: draft.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      toast.success(t(draft.id ? 'crm.tagManager.saved' : 'crm.tagManager.created'));
      setDraft(null);
      await fetchTags();
    } catch (err) {
      console.error('Save tag error:', err);
      toast.error(t('crm.tagManager.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!tagToDelete) return;
    try {
      setDeleting(true);
      const res = await fetch(`/api/tags/${tagToDelete.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      toast.success(t('crm.tagManager.deleted'));
      setTags((prev) => prev.filter((x) => x.id !== tagToDelete.id));
      setTagToDelete(null);
    } catch (err) {
      console.error('Delete error:', err);
      toast.error(t('crm.tagManager.deleteFailed'));
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('crm.tagManager.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('crm.tagManager.subtitle')}</p>
        </div>
        <Button onClick={() => setDraft({ ...EMPTY })} className="bg-primary text-primary-foreground hover:bg-primary/90">
          <Plus className="size-4" />
          {t('crm.tagManager.new')}
        </Button>
      </div>

      {tags.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-sm text-muted-foreground">{t('crm.tagManager.empty')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('crm.tagManager.emptyHint')}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="grid gap-1 pt-4">
            {tags.map((tag) => (
              <div key={tag.id} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent">
                <button
                  type="button"
                  onClick={() => setDraft({ id: tag.id, name: tag.name, color: tag.color, ai_hint: tag.ai_hint ?? '' })}
                  disabled={!isAdmin}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                  aria-label={t('crm.tagManager.editFor', { name: tag.name })}
                >
                  <span
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium"
                    style={{ backgroundColor: `${tag.color}20`, color: tag.color, border: `1px solid ${tag.color}40` }}
                  >
                    <span className="size-2 rounded-full" style={{ backgroundColor: tag.color }} />
                    {tag.name}
                  </span>
                  <span className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
                    {tag.ai_hint ? (
                      <>
                        <Sparkles aria-hidden className="size-3 shrink-0 text-primary" />
                        <span className="truncate">{tag.ai_hint}</span>
                      </>
                    ) : (
                      isAdmin && t('crm.tagManager.noHint')
                    )}
                  </span>
                </button>
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setTagToDelete(tag)}
                    aria-label={t('crm.tagManager.deleteFor', { name: tag.name })}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="size-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t(draft?.id ? 'crm.tagManager.editTitle' : 'crm.tagManager.newTitle')}</DialogTitle>
            <DialogDescription>{t('crm.tagManager.dialogDescription')}</DialogDescription>
          </DialogHeader>

          {draft && (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="tag-name">{t('crm.tagManager.name')}</Label>
                <Input
                  id="tag-name"
                  placeholder={t('crm.tagManager.namePlaceholder')}
                  value={draft.name}
                  maxLength={100}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">{t('crm.tagManager.color')}</legend>
                <div className="flex flex-wrap gap-2">
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setDraft({ ...draft, color })}
                      className="relative size-8 rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      style={{ backgroundColor: color, boxShadow: draft.color === color ? `0 0 0 2px var(--background), 0 0 0 4px ${color}` : 'none' }}
                      aria-label={t('crm.tagManager.pickColor', { color })}
                      aria-pressed={draft.color === color}
                    />
                  ))}
                </div>
              </fieldset>

              <div className="space-y-2">
                <Label htmlFor="tag-hint" className="flex items-center gap-1.5">
                  <Sparkles aria-hidden className="size-3.5 text-primary" />
                  {t('crm.tagManager.hint')}
                </Label>
                <Textarea
                  id="tag-hint"
                  rows={2}
                  maxLength={300}
                  placeholder={t('crm.tagManager.hintPlaceholder')}
                  value={draft.ai_hint}
                  onChange={(e) => setDraft({ ...draft, ai_hint: e.target.value })}
                  aria-describedby="tag-hint-help"
                />
                <p id="tag-hint-help" className="text-xs text-muted-foreground">
                  {t('crm.tagManager.hintHelp')}
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              {t('crm.common.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {saving && <Loader2 className="size-4 animate-spin" />}
              {saving ? t('crm.common.saving') : t('crm.common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!tagToDelete} onOpenChange={(o) => !o && setTagToDelete(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('crm.tagManager.deleteTitle')}</DialogTitle>
            <DialogDescription>{t('crm.tagManager.deleteDescription', { name: tagToDelete?.name ?? '' })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTagToDelete(null)}>
              {t('crm.common.cancel')}
            </Button>
            <Button onClick={handleDelete} disabled={deleting} variant="destructive">
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {deleting ? t('crm.common.deleting') : t('crm.common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

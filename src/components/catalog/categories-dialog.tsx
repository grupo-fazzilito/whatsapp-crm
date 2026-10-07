'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { invalidateAi } from '@/components/business/shared';
import type { Category } from './types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
  /** Product count per category id. */
  counts: Record<string, number>;
  onChanged: () => void;
}

export function CategoriesDialog({ open, onOpenChange, categories, counts, onChanged }: Props) {
  const t = useT();
  const { workspace, label } = useWorkspace();
  const plural = label('productPlural').toLowerCase();
  const list = useMemo(
    () => [...categories].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [categories],
  );
  // Names being edited (committed on blur).
  const [names, setNames] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState('');
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);

  const done = async (error: { message: string; code?: string } | null) => {
    if (error) {
      toast.error(error.code === '23505' ? t('catalog.categories.duplicate') : error.message);
      onChanged();
      return false;
    }
    await invalidateAi();
    onChanged();
    return true;
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim().slice(0, 80);
    if (!name || !workspace) return;
    setBusy(true);
    const maxOrder = list.reduce((m, c) => Math.max(m, c.sort_order), -1);
    const { error } = await createClient().from('product_categories').insert({ workspace_id: workspace.id, name, sort_order: maxOrder + 1 });
    setBusy(false);
    if (await done(error)) setNewName('');
  };

  const rename = async (c: Category) => {
    const edited = names[c.id];
    const clear = () =>
      setNames((n) => {
        const next = { ...n };
        delete next[c.id];
        return next;
      });
    const name = (edited ?? '').trim().slice(0, 80);
    if (edited === undefined || !name || name === c.name) {
      clear();
      return;
    }
    const { error } = await createClient().from('product_categories').update({ name }).eq('id', c.id);
    await done(error);
    clear();
  };

  const toggle = async (c: Category, is_active: boolean) => {
    const { error } = await createClient().from('product_categories').update({ is_active }).eq('id', c.id);
    await done(error);
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[idx], next[j]] = [next[j], next[idx]];
    setBusy(true);
    // Renumber everything so ties from older data disappear.
    const db = createClient();
    const changed = next.map((c, i) => ({ c, i })).filter(({ c, i }) => c.sort_order !== i);
    const results = await Promise.all(changed.map(({ c, i }) => db.from('product_categories').update({ sort_order: i }).eq('id', c.id)));
    await done(results.find((r) => r.error)?.error ?? null);
    setBusy(false);
  };

  const remove = async () => {
    if (!deleting) return;
    const { error } = await createClient().from('product_categories').delete().eq('id', deleting.id);
    if (await done(error)) toast.success(t('catalog.deleted'));
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('catalog.categories.title')}</DialogTitle>
            <DialogDescription>{t('catalog.categories.description', { products: plural })}</DialogDescription>
          </DialogHeader>

          <form onSubmit={add} className="flex gap-2">
            <Input
              aria-label={t('catalog.categories.namePlaceholder')}
              placeholder={t('catalog.categories.namePlaceholder')}
              maxLength={80}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Button type="submit" disabled={busy || !newName.trim()}>
              <Plus className="size-4" />
              {t('catalog.categories.create')}
            </Button>
          </form>

          {list.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('catalog.categories.empty')}</p>
          ) : (
            <ul className="grid max-h-[50vh] gap-2 overflow-y-auto pr-1">
              {list.map((c, idx) => (
                <li key={c.id} className="flex items-center gap-2 rounded-lg border border-border p-2">
                  <span className="flex flex-col">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      disabled={busy || idx === 0}
                      aria-label={t('catalog.categories.moveUp', { name: c.name })}
                      onClick={() => move(idx, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      disabled={busy || idx === list.length - 1}
                      aria-label={t('catalog.categories.moveDown', { name: c.name })}
                      onClick={() => move(idx, 1)}
                    >
                      <ArrowDown />
                    </Button>
                  </span>
                  <div className="min-w-0 flex-1">
                    <Input
                      aria-label={t('catalog.categories.rename', { name: c.name })}
                      maxLength={80}
                      value={names[c.id] ?? c.name}
                      onChange={(e) => setNames((n) => ({ ...n, [c.id]: e.target.value }))}
                      onBlur={() => rename(c)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                    />
                    <span className="mt-0.5 block px-1 text-xs text-muted-foreground">
                      {t('catalog.categories.count', { count: counts[c.id] ?? 0, products: plural })}
                    </span>
                  </div>
                  <Switch checked={c.is_active} aria-label={t('catalog.categories.active', { name: c.name })} onCheckedChange={(v) => toggle(c, v)} />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive"
                    aria-label={t('catalog.categories.delete', { name: c.name })}
                    onClick={() => setDeleting(c)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        isOpen={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('catalog.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('catalog.categories.deleteDescription', { count: deleting ? counts[deleting.id] ?? 0 : 0, products: plural })}
        confirmText={t('catalog.delete')}
        cancelText={t('catalog.cancel')}
        variant="destructive"
        onConfirm={remove}
      />
    </>
  );
}

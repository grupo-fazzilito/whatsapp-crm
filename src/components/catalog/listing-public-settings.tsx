'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Globe } from 'lucide-react';
import { useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { createClient } from '@/lib/supabase/client';
import type { WorkspaceSettings } from '@/lib/workspace/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';

/** Workspace-level settings of the public property pages (real estate, admins). */
export function ListingPublicSettings() {
  const t = useT();
  const { workspace, refresh, can } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  if (workspace?.industry !== 'real_estate' || !can('admin')) return null;

  const current = (workspace.settings?.real_estate ?? {}) as { listing_noindex?: boolean };
  const noindex = current.listing_noindex === true;

  const save = async (value: boolean) => {
    setSaving(true);
    const db = createClient();
    // Merge into the latest settings so other tabs' changes are kept.
    const { data, error: readErr } = await db.from('workspaces').select('settings').eq('id', workspace.id).single();
    if (readErr) {
      setSaving(false);
      toast.error(readErr.message);
      return;
    }
    const prev = (data?.settings as WorkspaceSettings) ?? {};
    const re = prev.real_estate && typeof prev.real_estate === 'object' ? (prev.real_estate as Record<string, unknown>) : {};
    const settings: WorkspaceSettings = { ...prev, real_estate: { ...re, listing_noindex: value } };
    const { error } = await db.from('workspaces').update({ settings }).eq('id', workspace.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await refresh();
    toast.success(t('realestate.listing.settingsSaved'));
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Globe className="size-4" aria-hidden />
        {t('realestate.listing.publicPage')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('realestate.listing.settingsTitle')}</DialogTitle>
            <DialogDescription>{t('realestate.listing.settingsDescription')}</DialogDescription>
          </DialogHeader>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <span>
              <span className="block text-sm font-medium text-foreground">{t('realestate.listing.noindex')}</span>
              <span className="block text-xs text-muted-foreground">{t('realestate.listing.noindexHint')}</span>
            </span>
            <Switch checked={noindex} disabled={saving} onCheckedChange={(v) => void save(v)} aria-label={t('realestate.listing.noindex')} />
          </label>
        </DialogContent>
      </Dialog>
    </>
  );
}

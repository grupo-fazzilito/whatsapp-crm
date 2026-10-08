'use client';

import { useEffect, useId, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { createClient } from '@/lib/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export interface ContactLite {
  id: string;
  name: string | null;
  phone: string | null;
}

const clean = (s: string) => s.replace(/[,()*%\\]/g, ' ').trim();

/** Search-as-you-type contact picker (name / phone). */
export function ContactPicker({ value, onChange }: { value: ContactLite | null; onChange: (c: ContactLite | null) => void }) {
  const { t } = useI18n();
  const { workspace } = useWorkspace();
  const id = useId();
  const listId = useId();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<ContactLite[]>([]);

  useEffect(() => {
    if (value || !workspace) return;
    const s = clean(q);
    if (!s) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const { data } = await createClient()
        .from('contacts')
        .select('id, name, phone')
        .eq('workspace_id', workspace.id)
        .or(`name.ilike.%${s}%,phone.ilike.%${s}%`)
        .order('name')
        .limit(8);
      if (!cancelled) setHits((data ?? []) as ContactLite[]);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, value, workspace]);

  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {t('crm.tasks.fields.contact')}
      </label>
      {value ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm">
          <span className="min-w-0 truncate">
            {value.name || value.phone}
            {value.name && value.phone && <span className="ml-1.5 text-xs text-muted-foreground">{value.phone}</span>}
          </span>
          <Button type="button" variant="ghost" size="icon-xs" onClick={() => onChange(null)} aria-label={t('crm.tasks.removeContact')}>
            <X />
          </Button>
        </div>
      ) : (
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={id}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('crm.tasks.searchContact')}
            className="h-9 pl-8"
            aria-controls={listId}
            autoComplete="off"
          />
          {hits.length > 0 && (
            <ul id={listId} className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md">
              {hits.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(c);
                      setQ('');
                      setHits([]);
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  >
                    <span className="truncate">{c.name || c.phone}</span>
                    {c.name && <span className="shrink-0 text-xs text-muted-foreground">{c.phone}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

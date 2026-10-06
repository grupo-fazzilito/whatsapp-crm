'use client';

import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/i18n/client';
import { Button } from '@/components/ui/button';

export function CopyField({ value, label, multiline }: { value: string; label?: string; multiline?: boolean }) {
  const t = useT();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t('common.copied'));
    } catch {
      toast.error(t('common.error'));
    }
  };
  return (
    <div className="grid gap-1.5">
      {label && <span className="text-xs font-medium text-muted-foreground">{label}</span>}
      <div className="flex items-start gap-2">
        <code
          className={
            'min-w-0 flex-1 rounded-md border border-border bg-muted/50 px-2.5 py-2 font-mono text-xs text-foreground ' +
            (multiline ? 'whitespace-pre-wrap break-all' : 'truncate')
          }
          title={value}
        >
          {value}
        </code>
        <Button type="button" variant="outline" size="sm" onClick={copy} aria-label={t('common.copy')}>
          <Copy className="size-3.5" />
          {t('common.copy')}
        </Button>
      </div>
    </div>
  );
}

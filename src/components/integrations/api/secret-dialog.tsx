'use client';

import { useId, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Check, Copy } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** A secret shown once (API key or webhook signing secret), with a copy button and usage notes. */
export function SecretDialog({
  secret,
  title,
  body,
  label,
  onClose,
  children,
}: {
  secret: string | null;
  title: string;
  body: string;
  label: string;
  onClose: () => void;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const fieldId = useId();

  const copy = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('integrations.common.error'));
    }
  };

  return (
    <Dialog open={!!secret} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <label htmlFor={fieldId} className="text-sm font-medium text-foreground">
            {label}
          </label>
          <div className="flex gap-2">
            <Input id={fieldId} readOnly value={secret ?? ''} onFocus={(e) => e.target.select()} className="font-mono text-xs" />
            <Button type="button" variant="outline" onClick={() => void copy()} className="shrink-0">
              {copied ? <Check className="size-4 text-primary" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              {t(copied ? 'integrations.common.copied' : 'integrations.common.copy')}
            </Button>
          </div>
          <span className="sr-only" aria-live="polite">
            {copied ? t('integrations.common.copied') : ''}
          </span>
        </div>
        {children}
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            {t('integrations.common.done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Small monospace block for code samples inside the dialogs. */
export function CodeSample({ title, body, code }: { title: string; body?: string; code: string }) {
  return (
    <section className="rounded-lg border border-border bg-muted/50 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">{title}</h3>
      {body && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>}
      <pre className="mt-2 overflow-x-auto rounded-md bg-background p-2.5 font-mono text-[11px] leading-relaxed text-foreground">{code}</pre>
    </section>
  );
}

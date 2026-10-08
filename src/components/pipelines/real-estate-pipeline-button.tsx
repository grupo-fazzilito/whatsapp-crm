'use client';

import { useState } from 'react';
import { Building2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { Button } from '@/components/ui/button';
import { REAL_ESTATE_PIPELINE_KEY } from '@/lib/real-estate/pipeline-keys';

interface Props {
  pipelines: { id: string; key?: string | null }[];
  /** Called with the pipeline id after it was created (or found). */
  onReady: (pipelineId: string) => void;
  className?: string;
}

/**
 * "Crear embudo inmobiliario": for real-estate workspaces (admins) that
 * don't have the keyed real-estate pipeline yet — e.g. the workspace
 * switched its industry after signup. Idempotent server-side.
 */
export function RealEstatePipelineButton({ pipelines, onReady, className }: Props) {
  const t = useT();
  const { workspace, can } = useWorkspace();
  const [busy, setBusy] = useState(false);

  if (workspace?.industry !== 'real_estate' || !can('admin')) return null;
  if (pipelines.some((p) => p.key === REAL_ESTATE_PIPELINE_KEY)) return null;

  const create = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/real-estate/pipeline', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { pipelineId?: string; created?: boolean };
      if (!res.ok || !body.pipelineId) throw new Error();
      toast.success(t(body.created ? 'realestate.pipeline.created' : 'realestate.pipeline.exists'));
      onReady(body.pipelineId);
    } catch {
      toast.error(t('realestate.pipeline.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={create}
      disabled={busy}
      title={t('realestate.pipeline.hint')}
      className={className ?? 'border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800'}
    >
      {busy ? <Loader2 className="mr-1 size-4 animate-spin" aria-hidden /> : <Building2 className="mr-1 size-4" aria-hidden />}
      {busy ? t('realestate.pipeline.creating') : t('realestate.pipeline.create')}
    </Button>
  );
}

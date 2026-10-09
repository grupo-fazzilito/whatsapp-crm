'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, ImagePlus, Loader2, Pencil, Plus, QrCode, Trash2, X } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { uploadFile } from '@/lib/storage/client';
import { api } from '../api';
import { getPreset } from '@/lib/industries';
import type { Workspace } from '@/lib/workspace/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from '@/components/catalog/types';
import { FULFILLMENTS, PAYMENT_METHOD_TYPES, type Fulfillment, type PaymentMethod, type PaymentMethodType } from '@/components/orders/types';
import { selectClass } from '../shared';

interface RawOrderSettings {
  fulfillment?: Fulfillment[];
  delivery_fee?: number;
  min_order?: number;
  notify_status?: boolean;
}

export function OrdersPaymentsForm({ workspace, readOnly }: { workspace: Workspace; readOnly: boolean }) {
  return (
    <div className="grid gap-6">
      <OrderSettingsCard workspace={workspace} readOnly={readOnly} />
      <PaymentMethodsCard workspace={workspace} readOnly={readOnly} />
    </div>
  );
}

// ------------------------------------------------------------
// workspaces.settings.orders
// ------------------------------------------------------------
function OrderSettingsCard({ workspace, readOnly }: { workspace: Workspace; readOnly: boolean }) {
  const { t } = useI18n();
  const { refresh } = useWorkspace();
  const raw = (workspace.settings?.orders ?? {}) as RawOrderSettings;
  const presetFulfillment = getPreset(workspace.industry).fulfillment as Fulfillment[];
  const [fulfillment, setFulfillment] = useState<Fulfillment[]>(() => {
    const list: Fulfillment[] = Array.isArray(raw.fulfillment) ? raw.fulfillment : presetFulfillment.length ? presetFulfillment : ['pickup'];
    return list.filter((f) => FULFILLMENTS.includes(f));
  });
  const [deliveryFee, setDeliveryFee] = useState(String(raw.delivery_fee ?? 0));
  const [minOrder, setMinOrder] = useState(String(raw.min_order ?? 0));
  const [notify, setNotify] = useState(raw.notify_status !== false);
  const [saving, setSaving] = useState(false);

  const toggle = (f: Fulfillment, on: boolean) =>
    setFulfillment((prev) => (on ? FULFILLMENTS.filter((x) => x === f || prev.includes(x)) : prev.filter((x) => x !== f)));

  const save = async () => {
    if (!fulfillment.length) {
      toast.error(t('orders.settings.fulfillmentRequired'));
      return;
    }
    const fee = Number(deliveryFee);
    const min = Number(minOrder);
    if (!Number.isFinite(fee) || fee < 0 || !Number.isFinite(min) || min < 0) {
      toast.error(t('orders.settings.invalidAmount'));
      return;
    }
    setSaving(true);
    try {
      // Merged by the server into the latest settings (other keys of `orders` are kept).
      await api('/api/business/workspace', {
        method: 'PATCH',
        body: {
          settings: {
            orders: {
              fulfillment,
              delivery_fee: Math.round(fee * 100) / 100,
              min_order: Math.round(min * 100) / 100,
              notify_status: notify,
            },
          },
        },
      });
    } catch (err) {
      setSaving(false);
      toast.error(err instanceof Error ? err.message : String(err));
      return;
    }
    setSaving(false);
    await refresh();
    toast.success(t('business.common.saved'));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('orders.settings.title')}</CardTitle>
        <CardDescription>{t('orders.settings.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <fieldset className="grid gap-2" disabled={readOnly}>
          <legend className="mb-1 text-sm font-medium">{t('orders.settings.fulfillment')}</legend>
          <div className="flex flex-wrap gap-4">
            {FULFILLMENTS.map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={fulfillment.includes(f)} onChange={(e) => toggle(f, e.target.checked)} />
                {t(`orders.fulfillment.${f}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid content-start gap-1.5">
            <Label htmlFor="orders-delivery-fee">{t('orders.settings.deliveryFee', { currency: workspace.currency })}</Label>
            <Input
              id="orders-delivery-fee"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={deliveryFee}
              disabled={readOnly || !fulfillment.includes('delivery')}
              onChange={(e) => setDeliveryFee(e.target.value)}
            />
          </div>
          <div className="grid content-start gap-1.5">
            <Label htmlFor="orders-min-order">{t('orders.settings.minOrder', { currency: workspace.currency })}</Label>
            <Input id="orders-min-order" type="number" inputMode="decimal" min={0} step="0.01" value={minOrder} disabled={readOnly} onChange={(e) => setMinOrder(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t('orders.settings.minOrderHint')}</p>
          </div>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="orders-notify">{t('orders.settings.notify')}</Label>
            <p className="text-xs text-muted-foreground">{t('orders.settings.notifyHint')}</p>
          </div>
          <Switch id="orders-notify" checked={notify} disabled={readOnly} onCheckedChange={(v) => setNotify(!!v)} />
        </div>
        {!readOnly && (
          <div>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {t('business.common.save')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------
// payment_methods
// ------------------------------------------------------------
function PaymentMethodsCard({ workspace, readOnly }: { workspace: Workspace; readOnly: boolean }) {
  const { t } = useI18n();
  const [methods, setMethods] = useState<PaymentMethod[] | null>(null);
  const [editing, setEditing] = useState<PaymentMethod | 'new' | null>(null);
  const [deleting, setDeleting] = useState<PaymentMethod | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setMethods((await api<{ methods: PaymentMethod[] }>('/api/business/payment-methods')).methods);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setMethods([]);
    }
  }, []);

  // Reloads when the active workspace changes.
  const workspaceId = workspace.id;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (workspaceId) load();
  }, [load, workspaceId]);

  const move = async (idx: number, dir: -1 | 1) => {
    if (!methods) return;
    const j = idx + dir;
    if (j < 0 || j >= methods.length) return;
    const next = [...methods];
    [next[idx], next[j]] = [next[j], next[idx]];
    setMethods(next);
    setBusy(true);
    try {
      // Renumbers everything so ties from older rows don't make swaps no-ops.
      await api('/api/business/payment-methods/reorder', { method: 'POST', body: { ids: next.map((m) => m.id) } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
    await load();
  };

  const toggleActive = async (m: PaymentMethod, on: boolean) => {
    setMethods((prev) => prev?.map((x) => (x.id === m.id ? { ...x, is_active: on } : x)) ?? prev);
    try {
      await api(`/api/business/payment-methods/${m.id}`, { method: 'PATCH', body: { is_active: on } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      await load();
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      // The server also deletes the QR image file.
      await api(`/api/business/payment-methods/${deleting.id}`, { method: 'DELETE' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return;
    }
    setDeleting(null);
    toast.success(t('orders.methods.deleted'));
    await load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('orders.methods.title')}</CardTitle>
        <CardDescription>{t('orders.methods.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {methods === null ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : methods.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('orders.methods.empty')}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {methods.map((m, i) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
                  {m.qr_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.qr_image_url} alt="" className="size-full object-cover" />
                  ) : (
                    <QrCode aria-hidden className="size-4 text-muted-foreground" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{m.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t(`orders.methods.types.${m.type}`)}
                    {m.requires_proof ? ` · ${t('orders.methods.proofShort')}` : ''}
                  </p>
                </div>
                {!readOnly && (
                  <div className="flex items-center gap-1">
                    <Switch checked={m.is_active} onCheckedChange={(v) => toggleActive(m, !!v)} aria-label={t('orders.methods.activeFor', { name: m.name })} />
                    <Button variant="ghost" size="icon-sm" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={t('orders.methods.moveUp', { name: m.name })}>
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" disabled={busy || i === methods.length - 1} onClick={() => move(i, 1)} aria-label={t('orders.methods.moveDown', { name: m.name })}>
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => setEditing(m)} aria-label={t('orders.methods.edit', { name: m.name })}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => setDeleting(m)} aria-label={t('orders.methods.delete', { name: m.name })}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                )}
                {readOnly && !m.is_active && <span className="text-xs text-muted-foreground">{t('orders.methods.inactive')}</span>}
              </li>
            ))}
          </ul>
        )}
        {!readOnly && (
          <div>
            <Button variant="outline" onClick={() => setEditing('new')}>
              <Plus className="size-4" />
              {t('orders.methods.add')}
            </Button>
          </div>
        )}
      </CardContent>
      {editing && (
        <MethodEditor
          method={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
      <ConfirmationDialog
        isOpen={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('orders.methods.deleteTitle')}
        description={t('orders.methods.deleteDescription', { name: deleting?.name ?? '' })}
        confirmText={t('orders.methods.deleteConfirm')}
        variant="destructive"
        onConfirm={remove}
      />
    </Card>
  );
}

function MethodEditor({
  method,
  onClose,
  onSaved,
}: {
  method: PaymentMethod | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(method?.name ?? '');
  const [type, setType] = useState<PaymentMethodType>(method?.type ?? 'qr');
  const [instructions, setInstructions] = useState(method?.instructions ?? '');
  const [requiresProof, setRequiresProof] = useState(method?.requires_proof ?? true);
  const [active, setActive] = useState(method?.is_active ?? true);
  // Current image: saved URL, a new local file, or none.
  const [qrUrl, setQrUrl] = useState<string | null>(method?.qr_image_url ?? null);
  const [file, setFile] = useState<{ file: File; preview: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (file) URL.revokeObjectURL(file.preview);
  }, [file]);

  const pick = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (!IMAGE_TYPES.includes(f.type)) {
      toast.error(t('orders.methods.badImage'));
      return;
    }
    if (f.size > MAX_IMAGE_BYTES) {
      toast.error(t('orders.methods.imageTooBig'));
      return;
    }
    setFile({ file: f, preview: URL.createObjectURL(f) });
  };

  const save = async () => {
    if (!name.trim()) {
      toast.error(t('orders.methods.nameRequired'));
      return;
    }
    setSaving(true);
    try {
      let finalUrl = qrUrl;
      if (file) {
        try {
          finalUrl = (await uploadFile('catalog', file.file, { folder: 'payments' })).url;
        } catch (err) {
          throw new Error(t('orders.methods.uploadFailed', { reason: err instanceof Error ? err.message : String(err) }));
        }
      }
      const row = {
        name: name.trim().slice(0, 60),
        type,
        instructions: instructions.trim() ? instructions.trim().slice(0, 1000) : null,
        qr_image_url: finalUrl,
        requires_proof: requiresProof,
        is_active: active,
      };
      // The server deletes a replaced/removed QR file (or the new one if saving fails).
      if (method) await api(`/api/business/payment-methods/${method.id}`, { method: 'PATCH', body: row });
      else await api('/api/business/payment-methods', { method: 'POST', body: row });
      toast.success(t('business.common.saved'));
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const preview = file?.preview ?? qrUrl;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{method ? t('orders.methods.editTitle') : t('orders.methods.newTitle')}</DialogTitle>
          <DialogDescription>{t('orders.methods.editorHint')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid content-start gap-1.5">
              <Label htmlFor="pm-name">{t('orders.methods.name')}</Label>
              <Input id="pm-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={t('orders.methods.namePlaceholder')} />
            </div>
            <div className="grid content-start gap-1.5">
              <Label htmlFor="pm-type">{t('orders.methods.type')}</Label>
              <select id="pm-type" className={selectClass} value={type} onChange={(e) => setType(e.target.value as PaymentMethodType)}>
                {PAYMENT_METHOD_TYPES.map((k) => (
                  <option key={k} value={k}>
                    {t(`orders.methods.types.${k}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid content-start gap-1.5">
            <Label htmlFor="pm-instructions">{t('orders.methods.instructions')}</Label>
            <Textarea
              id="pm-instructions"
              rows={4}
              maxLength={1000}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={t('orders.methods.instructionsPlaceholder')}
            />
          </div>
          <div className="grid content-start gap-1.5">
            <span className="text-sm font-medium">{t('orders.methods.qr')}</span>
            <div className="flex items-center gap-3">
              {preview ? (
                <span className="relative size-28 overflow-hidden rounded-lg border border-border bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={preview} alt={t('orders.methods.qrAlt')} className="size-full object-contain" />
                </span>
              ) : (
                <span className="flex size-28 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground">
                  <QrCode aria-hidden className="size-6" />
                </span>
              )}
              <div className="flex flex-col gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
                  <ImagePlus className="size-3.5" />
                  {preview ? t('orders.methods.replaceImage') : t('orders.methods.uploadImage')}
                </Button>
                {preview && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (file) URL.revokeObjectURL(file.preview);
                      setFile(null);
                      setQrUrl(null);
                    }}
                  >
                    <X className="size-3.5" />
                    {t('orders.methods.removeImage')}
                  </Button>
                )}
              </div>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept={IMAGE_TYPES.join(',')}
              hidden
              onChange={(e) => {
                pick(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="pm-proof">{t('orders.methods.requiresProof')}</Label>
              <p className="text-xs text-muted-foreground">{t('orders.methods.requiresProofHint')}</p>
            </div>
            <Switch id="pm-proof" checked={requiresProof} onCheckedChange={(v) => setRequiresProof(!!v)} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="pm-active">{t('orders.methods.active')}</Label>
            <Switch id="pm-active" checked={active} onCheckedChange={(v) => setActive(!!v)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t('business.common.cancel')}
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {t('business.common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

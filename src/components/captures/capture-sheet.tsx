'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ExternalLink, ImagePlus, Loader2, MessageSquare, Rocket, Trash2, X } from 'lucide-react';
import { useI18n, useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { uploadFile } from '@/lib/storage/client';
import { getPreset } from '@/lib/industries';
import { ATTACHMENTS_REF_PREFIX, CAPTURE_STATUSES, type CaptureStatus } from '@/lib/real-estate/captures-core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { LoadingBlock, selectClass } from '@/components/business/shared';
import { useMembers } from '@/components/crm';
import { cn } from '@/lib/utils';
import { STATUS_TONE, type CaptureDetail } from './types';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

interface Photo {
  ref: string;
  url: string;
}

interface Draft {
  owner_name: string;
  owner_phone: string;
  operation: string;
  property_type: string;
  address: string;
  district: string;
  area_m2: string;
  bedrooms: string;
  bathrooms: string;
  parking: string;
  expected_price: string;
  currency: string;
  description: string;
  status: CaptureStatus;
  assigned_user_id: string;
  notes: string;
}

const s = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v));

function toDraft(c: CaptureDetail | null, currency: string): Draft {
  return {
    owner_name: s(c?.owner_name),
    owner_phone: s(c?.owner_phone),
    operation: s(c?.operation),
    property_type: s(c?.property_type),
    address: s(c?.address),
    district: s(c?.district),
    area_m2: s(c?.area_m2),
    bedrooms: s(c?.bedrooms),
    bathrooms: s(c?.bathrooms),
    parking: s(c?.parking),
    expected_price: s(c?.expected_price),
    currency: c?.currency ?? currency,
    description: s(c?.description),
    status: c?.status ?? 'new',
    assigned_user_id: s(c?.assigned_user_id),
    notes: s(c?.notes),
  };
}

interface Props {
  /** Capture id, or 'new'. */
  captureId: string;
  onClose: () => void;
  onChanged: () => void;
}

export function CaptureSheet({ captureId, onClose, onChanged }: Props) {
  const t = useT();
  const { locale } = useI18n();
  const { workspace, can } = useWorkspace();
  const { members } = useMembers();
  const isNew = captureId === 'new';
  const isAdmin = can('admin');
  const [capture, setCapture] = useState<CaptureDetail | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [draft, setDraft] = useState<Draft>(() => toDraft(null, workspace?.currency ?? 'PEN'));
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [confirm, setConfirm] = useState<'publish' | 'delete' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const typeField = getPreset('real_estate').productAttributes.find((f) => f.key === 'property_type');

  const apply = (c: CaptureDetail) => {
    setCapture(c);
    setDraft(toDraft(c, workspace?.currency ?? 'PEN'));
    setPhotos((c.photos ?? []).map((ref, i) => ({ ref, url: c.photo_urls?.[i] ?? '' })));
  };

  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    fetch(`/api/captures/${captureId}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { capture: CaptureDetail };
        if (!cancelled) apply(body.capture);
      })
      .catch(() => {
        if (!cancelled) {
          toast.error(t('realestate.captures.error.notFound'));
          onClose();
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureId]);

  const upload = async (files: FileList | null) => {
    if (!files?.length || !workspace) return;
    setUploading(true);
    const added: Photo[] = [];
    for (const file of Array.from(files)) {
      if (!IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_BYTES) {
        toast.error(t('realestate.captures.toast.uploadFailed', { reason: file.name }));
        continue;
      }
      const ext = file.type.split('/')[1].replace('jpeg', 'jpg');
      const path = `${workspace.id}/captures/${crypto.randomUUID()}.${ext}`;
      try {
        await uploadFile('attachments', file, { path });
      } catch (err) {
        toast.error(t('realestate.captures.toast.uploadFailed', { reason: err instanceof Error ? err.message : String(err) }));
        continue;
      }
      added.push({ ref: ATTACHMENTS_REF_PREFIX + path, url: URL.createObjectURL(file) });
    }
    setPhotos((p) => [...p, ...added].slice(0, 30));
    setUploading(false);
  };

  const payload = () => ({
    ...draft,
    operation: draft.operation || null,
    property_type: draft.property_type || null,
    assigned_user_id: draft.assigned_user_id || null,
    currency: draft.currency || null,
    photos: photos.map((p) => p.ref),
  });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const res = await fetch(isNew ? '/api/captures' : `/api/captures/${captureId}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      const body = (await res.json().catch(() => ({}))) as { capture?: CaptureDetail; errors?: Record<string, string> };
      if (!res.ok) {
        if (body.errors) setErrors(body.errors);
        toast.error(t(body.errors ? 'realestate.captures.error.invalid' : 'realestate.captures.toast.error'));
        return;
      }
      toast.success(t(isNew ? 'realestate.captures.toast.created' : 'realestate.captures.toast.saved'));
      onChanged();
      if (isNew) onClose();
      else if (body.capture) apply(body.capture);
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    setPublishing(true);
    try {
      // Save pending edits first so the listing gets them.
      const saveRes = await fetch(`/api/captures/${captureId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      if (!saveRes.ok) {
        const b = (await saveRes.json().catch(() => ({}))) as { errors?: Record<string, string> };
        if (b.errors) setErrors(b.errors);
        toast.error(t('realestate.captures.error.invalid'));
        return;
      }
      const res = await fetch(`/api/captures/${captureId}/publish`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { photosFailed?: number; error?: string };
      if (!res.ok) {
        toast.error(
          t(
            res.status === 409
              ? 'realestate.captures.error.alreadyPublished'
              : res.status === 403
                ? 'realestate.captures.error.adminOnly'
                : 'realestate.captures.toast.error',
          ),
        );
        return;
      }
      toast.success(
        body.photosFailed
          ? t('realestate.captures.toast.publishedPartial', { count: body.photosFailed })
          : t('realestate.captures.toast.published'),
      );
      onChanged();
      const fresh = await fetch(`/api/captures/${captureId}`, { cache: 'no-store' });
      if (fresh.ok) apply(((await fresh.json()) as { capture: CaptureDetail }).capture);
    } finally {
      setPublishing(false);
    }
  };

  const remove = async () => {
    const res = await fetch(`/api/captures/${captureId}`, { method: 'DELETE' });
    if (!res.ok) {
      toast.error(t('realestate.captures.toast.error'));
      return;
    }
    toast.success(t('realestate.captures.toast.deleted'));
    onChanged();
    onClose();
  };

  const err = (k: string) =>
    errors[k] ? (
      <p id={`cap-${k}-err`} className="text-xs text-destructive">
        {errors[k] === 'number' ? t('realestate.captures.error.number') : t('realestate.captures.error.invalid')}
      </p>
    ) : null;

  const textInput = (k: keyof Draft, label: string, opts: { type?: string; inputMode?: 'decimal' | 'numeric' | 'tel'; maxLength?: number } = {}) => (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={`cap-${k}`}>{label}</Label>
      <Input
        id={`cap-${k}`}
        type={opts.type ?? 'text'}
        inputMode={opts.inputMode}
        maxLength={opts.maxLength ?? 300}
        value={draft[k]}
        aria-invalid={!!errors[k]}
        aria-describedby={errors[k] ? `cap-${k}-err` : undefined}
        onChange={(e) => set(k, e.target.value as Draft[typeof k])}
      />
      {err(k)}
    </div>
  );

  const published = !!capture?.product_id;
  const title = isNew ? t('realestate.captures.detail.newTitle') : capture?.owner_name || capture?.contact?.name || t('realestate.captures.detail.title');

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full! flex-col gap-0 sm:max-w-2xl!">
        {loading ? (
          <>
            <SheetHeader className="border-b border-border pr-12">
              <SheetTitle>{t('realestate.captures.detail.title')}</SheetTitle>
              <SheetDescription>{t('realestate.captures.detail.description')}</SheetDescription>
            </SheetHeader>
            <LoadingBlock />
          </>
        ) : (
          <form onSubmit={save} className="flex min-h-0 flex-1 flex-col" noValidate>
            <SheetHeader className="border-b border-border pr-12">
              <SheetTitle className="flex flex-wrap items-center gap-2">
                {title}
                {capture && (
                  <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold', STATUS_TONE[capture.status])}>
                    {t(`realestate.captures.status.${capture.status}`)}
                  </span>
                )}
                {capture?.source === 'ai' && (
                  <span className="rounded border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {t('realestate.captures.source.ai')}
                  </span>
                )}
              </SheetTitle>
              <SheetDescription>{t('realestate.captures.detail.description')}</SheetDescription>
              {capture && (capture.conversation_id || capture.product) && (
                <div className="flex flex-wrap gap-3 pt-1 text-sm">
                  {capture.conversation_id && (
                    <Link href={`/inbox?c=${capture.conversation_id}`} className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
                      <MessageSquare className="size-3.5" aria-hidden />
                      {t('realestate.captures.detail.openChat')}
                    </Link>
                  )}
                  {capture.product && (
                    <Link href="/catalog" className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
                      {t('realestate.captures.detail.openProduct')}: {capture.product.name}
                    </Link>
                  )}
                  {capture.product?.public_url && (
                    <a
                      href={capture.product.public_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                    >
                      {t('realestate.captures.detail.openPublic')}
                      <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  )}
                </div>
              )}
            </SheetHeader>

            <div className="grid flex-1 content-start gap-6 overflow-y-auto px-4 py-5">
              {/* Status + assignee */}
              <section className="grid gap-4 sm:grid-cols-2" aria-label={t('realestate.captures.field.status')}>
                <div className="grid gap-1.5">
                  <Label htmlFor="cap-status">{t('realestate.captures.field.status')}</Label>
                  <select
                    id="cap-status"
                    className={selectClass}
                    value={draft.status}
                    disabled={published}
                    onChange={(e) => set('status', e.target.value as CaptureStatus)}
                  >
                    {CAPTURE_STATUSES.filter((st) => st !== 'published' || published).map((st) => (
                      <option key={st} value={st}>
                        {t(`realestate.captures.status.${st}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="cap-assigned">{t('realestate.captures.field.assigned')}</Label>
                  <select id="cap-assigned" className={selectClass} value={draft.assigned_user_id} onChange={(e) => set('assigned_user_id', e.target.value)}>
                    <option value="">{t('realestate.captures.unassigned')}</option>
                    {members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              </section>

              {/* Owner */}
              <section className="grid gap-4 sm:grid-cols-2" aria-labelledby="cap-sec-owner">
                <h3 id="cap-sec-owner" className="text-sm font-semibold text-foreground sm:col-span-2">
                  {t('realestate.captures.field.owner')}
                </h3>
                {textInput('owner_name', t('realestate.captures.field.ownerName'), { maxLength: 120 })}
                {textInput('owner_phone', t('realestate.captures.field.ownerPhone'), { type: 'tel', inputMode: 'tel', maxLength: 40 })}
              </section>

              {/* Property */}
              <section className="grid gap-4 sm:grid-cols-2" aria-labelledby="cap-sec-prop">
                <h3 id="cap-sec-prop" className="text-sm font-semibold text-foreground sm:col-span-2">
                  {t('realestate.captures.detail.property')}
                </h3>
                <div className="grid gap-1.5">
                  <Label htmlFor="cap-operation">{t('realestate.captures.field.operation')}</Label>
                  <select id="cap-operation" className={selectClass} value={draft.operation} onChange={(e) => set('operation', e.target.value)}>
                    <option value="">{t('realestate.captures.field.choose')}</option>
                    <option value="sale">{t('realestate.captures.operation.sale')}</option>
                    <option value="rent">{t('realestate.captures.operation.rent')}</option>
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="cap-type">{t('realestate.captures.field.propertyType')}</Label>
                  <select id="cap-type" className={selectClass} value={draft.property_type} onChange={(e) => set('property_type', e.target.value)}>
                    <option value="">{t('realestate.captures.field.choose')}</option>
                    {typeField?.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label[locale]}
                      </option>
                    ))}
                    {draft.property_type && !typeField?.options?.some((o) => o.value === draft.property_type) && (
                      <option value={draft.property_type}>{draft.property_type}</option>
                    )}
                  </select>
                </div>
                {textInput('address', t('realestate.captures.field.address'))}
                {textInput('district', t('realestate.captures.field.district'), { maxLength: 120 })}
                {textInput('area_m2', t('realestate.captures.field.area'), { inputMode: 'decimal', maxLength: 20 })}
                {textInput('bedrooms', t('realestate.captures.field.bedrooms'), { inputMode: 'numeric', maxLength: 6 })}
                {textInput('bathrooms', t('realestate.captures.field.bathrooms'), { inputMode: 'numeric', maxLength: 6 })}
                {textInput('parking', t('realestate.captures.field.parking'), { inputMode: 'numeric', maxLength: 6 })}
                {textInput('expected_price', t('realestate.captures.field.expectedPrice'), { inputMode: 'decimal', maxLength: 24 })}
                <div className="grid gap-1.5">
                  <Label htmlFor="cap-currency">{t('realestate.captures.field.currency')}</Label>
                  <select id="cap-currency" className={selectClass} value={draft.currency} onChange={(e) => set('currency', e.target.value)}>
                    {[...new Set([workspace?.currency ?? 'PEN', 'USD', draft.currency].filter(Boolean))].map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="cap-description">{t('realestate.captures.field.description')}</Label>
                  <Textarea id="cap-description" rows={4} maxLength={4000} value={draft.description} onChange={(e) => set('description', e.target.value)} />
                </div>
              </section>

              {/* Photos */}
              <section className="grid gap-3" aria-labelledby="cap-sec-photos">
                <div className="flex items-center justify-between gap-2">
                  <h3 id="cap-sec-photos" className="text-sm font-semibold text-foreground">
                    {t('realestate.captures.field.photos')}
                  </h3>
                  <Button type="button" variant="outline" size="sm" disabled={uploading || photos.length >= 30} onClick={() => fileRef.current?.click()}>
                    {uploading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ImagePlus className="size-3.5" aria-hidden />}
                    {uploading ? t('realestate.captures.detail.uploading') : t('realestate.captures.detail.addPhotos')}
                  </Button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept={IMAGE_TYPES.join(',')}
                    multiple
                    hidden
                    tabIndex={-1}
                    onChange={(e) => {
                      void upload(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </div>
                {photos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('realestate.captures.detail.noPhotos')}</p>
                ) : (
                  <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {photos.map((p, i) => (
                      <li key={p.ref} className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
                        {p.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.url} alt={t('realestate.captures.detail.photo', { n: i + 1 })} className="size-full object-cover" loading="lazy" />
                        ) : (
                          <span className="flex size-full items-center justify-center p-2 text-center text-xs text-muted-foreground">
                            {t('realestate.captures.detail.photoError')}
                          </span>
                        )}
                        <button
                          type="button"
                          aria-label={t('realestate.captures.detail.removePhoto', { n: i + 1 })}
                          onClick={() => setPhotos((list) => list.filter((x) => x.ref !== p.ref))}
                          className="absolute right-1 top-1 flex size-7 items-center justify-center rounded-full bg-black/70 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <X className="size-4" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Notes */}
              <section className="grid gap-1.5">
                <Label htmlFor="cap-notes">{t('realestate.captures.field.notes')}</Label>
                <Textarea
                  id="cap-notes"
                  rows={4}
                  maxLength={4000}
                  placeholder={t('realestate.captures.field.notesPlaceholder')}
                  value={draft.notes}
                  onChange={(e) => set('notes', e.target.value)}
                />
              </section>

              {capture?.published_at && (
                <p className="text-xs text-muted-foreground">
                  {t('realestate.captures.detail.publishedOn', { date: new Date(capture.published_at).toLocaleDateString(locale === 'en' ? 'en-US' : 'es-PE') })}
                </p>
              )}
            </div>

            <SheetFooter className="flex-row flex-wrap justify-between gap-2 border-t border-border">
              <div className="flex flex-wrap gap-2">
                {!isNew && isAdmin && !published && (
                  <Button type="button" variant="secondary" disabled={publishing || saving} onClick={() => setConfirm('publish')}>
                    {publishing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Rocket className="size-4" aria-hidden />}
                    {publishing ? t('realestate.captures.actions.publishing') : t('realestate.captures.actions.publish')}
                  </Button>
                )}
                {!isNew && isAdmin && (
                  <Button type="button" variant="ghost" className="text-destructive" onClick={() => setConfirm('delete')}>
                    <Trash2 className="size-4" aria-hidden />
                    {t('realestate.captures.actions.delete')}
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={onClose}>
                  {t('realestate.captures.actions.cancel')}
                </Button>
                <Button type="submit" disabled={saving || uploading}>
                  {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  {isNew ? t('realestate.captures.actions.create') : saving ? t('realestate.captures.actions.saving') : t('realestate.captures.actions.save')}
                </Button>
              </div>
            </SheetFooter>
          </form>
        )}
      </SheetContent>

      <ConfirmationDialog
        isOpen={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'publish' ? t('realestate.captures.actions.publishTitle') : t('realestate.captures.actions.deleteTitle')}
        description={confirm === 'publish' ? t('realestate.captures.actions.publishDescription') : t('realestate.captures.actions.deleteDescription')}
        confirmText={confirm === 'publish' ? t('realestate.captures.actions.publish') : t('realestate.captures.actions.delete')}
        cancelText={t('realestate.captures.actions.cancel')}
        variant={confirm === 'delete' ? 'destructive' : 'default'}
        onConfirm={() => (confirm === 'publish' ? publish() : remove())}
      />
    </Sheet>
  );
}

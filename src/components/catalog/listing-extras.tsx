'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Copy, ExternalLink, Globe, MapPin } from 'lucide-react';
import { useI18n, useT } from '@/i18n/client';
import type { AttributeField } from '@/lib/industries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { coordsFrom, googleMapsUrl, isValidLatLng, osmEmbedUrl, osmLink, parseCoordinates } from '@/lib/real-estate/listing/geo';
import { HIDDEN_STATUSES, listingStatusOf, listingStatusTone, safeHttpUrl, type ListingStatus } from '@/lib/real-estate/listing/status';
import { propertyUrl } from '@/lib/real-estate/listing/url';
import type { RawAttributes } from './attribute-fields';

/** Real-estate attributes rendered by ListingExtras instead of the generic grid. */
export const LISTING_EXTRA_KEYS = ['latitude', 'longitude', 'video_url', 'virtual_tour_url'];

const num = (v: unknown) => (typeof v === 'string' && v.trim() ? Number(v.replace(',', '.')) : typeof v === 'number' ? v : NaN);

/**
 * Extra checks for the real-estate fields (on top of validateAttributes):
 * coordinates in range (both or none) and http(s) media links.
 */
export function validateListingExtras(values: RawAttributes): Record<string, string> {
  const errors: Record<string, string> = {};
  const lat = values.latitude;
  const lng = values.longitude;
  const hasLat = typeof lat === 'string' && lat.trim() !== '';
  const hasLng = typeof lng === 'string' && lng.trim() !== '';
  if (hasLat || hasLng) {
    if (!isValidLatLng(num(lat), num(lng))) {
      errors.latitude = 'coords';
      errors.longitude = 'coords';
    }
  }
  for (const k of ['video_url', 'virtual_tour_url']) {
    const v = values[k];
    if (typeof v === 'string' && v.trim() && !safeHttpUrl(v)) errors[k] = 'url';
  }
  return errors;
}

/** Status pill used on catalog cards and rows. */
export function ListingStatusBadge({ status, className }: { status: ListingStatus; className?: string }) {
  const t = useT();
  return (
    <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold', listingStatusTone(status), className)}>
      {t(`realestate.listing.status.${status}`)}
    </span>
  );
}

interface Props {
  fields: AttributeField[];
  values: RawAttributes;
  errors: Record<string, string>;
  readOnly: boolean;
  onChange: (key: string, value: string) => void;
  name: string;
  productId: string | null;
  isActive: boolean;
  workspaceSlug: string | null;
}

/** Map (OpenStreetMap preview, Google Maps link), video / tour links and the public page link. */
export function ListingExtras({ fields, values, errors, readOnly, onChange, name, productId, isActive, workspaceSlug }: Props) {
  const t = useT();
  const { locale } = useI18n();
  const [paste, setPaste] = useState('');
  const [pasteError, setPasteError] = useState(false);
  const field = (k: string) => fields.find((f) => f.key === k);
  const coords = coordsFrom(values);
  const address = typeof values.address === 'string' ? values.address : '';
  const status = listingStatusOf(values);

  const applyPaste = () => {
    const c = parseCoordinates(paste);
    if (!c) {
      setPasteError(true);
      return;
    }
    onChange('latitude', String(c.lat));
    onChange('longitude', String(c.lng));
    setPaste('');
    setPasteError(false);
    toast.success(t('realestate.listing.pasteOk'));
  };

  const input = (k: string, type: 'number' | 'url') => {
    const f = field(k);
    if (!f) return null;
    const id = `attr-${k}`;
    const err = errors[k];
    const hintId = `${id}-hint`;
    return (
      <div className="grid content-start gap-1.5">
        <Label htmlFor={id}>{f.label[locale]}</Label>
        <Input
          id={id}
          type={type === 'number' ? 'number' : 'url'}
          inputMode={type === 'number' ? 'decimal' : 'url'}
          step={type === 'number' ? 'any' : undefined}
          maxLength={type === 'url' ? 300 : undefined}
          placeholder={type === 'url' ? 'https://' : undefined}
          value={typeof values[k] === 'string' ? (values[k] as string) : ''}
          disabled={readOnly}
          aria-invalid={!!err}
          aria-describedby={err ? hintId : undefined}
          onChange={(e) => onChange(k, e.target.value)}
        />
        {err && (
          <p id={hintId} className="text-xs text-destructive">
            {err === 'url' ? t('realestate.listing.invalidUrl') : err === 'coords' ? t('realestate.listing.invalidCoords') : t(`catalog.attrError.${err}`)}
          </p>
        )}
      </div>
    );
  };

  const publicUrl = productId && workspaceSlug ? propertyUrl({ slug: workspaceSlug }, { id: productId }) : null;
  const publicAvailable = !!publicUrl && isActive && !HIDDEN_STATUSES.includes(status);

  return (
    <div className="grid gap-5">
      {/* Map */}
      <div className="grid gap-3">
        {!readOnly && (
          <div className="grid gap-1.5">
            <Label htmlFor="listing-paste">{t('realestate.listing.pasteLabel')}</Label>
            <div className="flex gap-2">
              <Input
                id="listing-paste"
                value={paste}
                placeholder={t('realestate.listing.pastePlaceholder')}
                aria-invalid={pasteError}
                aria-describedby="listing-paste-hint"
                onChange={(e) => {
                  setPaste(e.target.value);
                  setPasteError(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    applyPaste();
                  }
                }}
              />
              <Button type="button" variant="outline" className="h-9 shrink-0" onClick={applyPaste} disabled={!paste.trim()}>
                <MapPin className="size-4" aria-hidden />
                {t('realestate.listing.pasteApply')}
              </Button>
            </div>
            <p id="listing-paste-hint" className={cn('text-xs', pasteError ? 'text-destructive' : 'text-muted-foreground')} role={pasteError ? 'alert' : undefined}>
              {pasteError ? t('realestate.listing.pasteInvalid') : t('realestate.listing.pasteHint')}
            </p>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {input('latitude', 'number')}
          {input('longitude', 'number')}
        </div>
        {coords ? (
          <div className="grid gap-2">
            <iframe
              title={t('realestate.listing.mapTitle', { name: name || '—' })}
              src={osmEmbedUrl(coords)}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="h-56 w-full rounded-lg border border-border"
            />
            <div className="flex flex-wrap gap-3 text-sm">
              <a href={googleMapsUrl(coords)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
                {t('realestate.listing.openGoogle')}
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
              <a href={osmLink(coords)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
                {t('realestate.listing.openOsm')}
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            </div>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
            {t('realestate.listing.noCoords')}
            {address.trim() && (
              <>
                {' '}
                <a href={googleMapsUrl(address)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
                  {t('realestate.listing.openGoogle')}
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
              </>
            )}
          </p>
        )}
      </div>

      {/* Media */}
      <div className="grid gap-4 sm:grid-cols-2">
        {input('video_url', 'url')}
        {input('virtual_tour_url', 'url')}
      </div>

      {/* Public page */}
      <div className="grid gap-2 rounded-lg border border-border p-3">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Globe className="size-4" aria-hidden />
          {t('realestate.listing.publicPage')}
        </p>
        <p className="text-xs text-muted-foreground">
          {!publicUrl ? t('realestate.listing.publicSaveFirst') : publicAvailable ? t('realestate.listing.publicPageHint') : t('realestate.listing.publicInactive')}
        </p>
        {publicUrl && publicAvailable && (
          <div className="flex flex-wrap items-center gap-2">
            <Input readOnly value={publicUrl} aria-label={t('realestate.listing.publicPage')} className="min-w-0 flex-1 text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(publicUrl);
                  toast.success(t('realestate.listing.copied'));
                } catch {
                  /* clipboard blocked: the field stays selectable */
                }
              }}
            >
              <Copy className="size-3.5" aria-hidden />
              {t('realestate.listing.copyLink')}
            </Button>
            <a
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm text-primary underline-offset-4 hover:underline"
            >
              {t('realestate.listing.openPublic')}
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}


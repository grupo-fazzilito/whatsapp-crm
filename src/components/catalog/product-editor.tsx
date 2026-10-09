'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Check, Loader2, Plus, X } from 'lucide-react';
import { useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { ApiError, apiJson } from '@/lib/crm/api-client';
import { uploadFile } from '@/lib/storage/client';
import type { AttributeField } from '@/lib/industries';
import { validateAttributes } from '@/lib/catalog/attributes';
import { PRODUCT_CURRENCIES } from '@/lib/catalog/currency';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { invalidateAi, selectClass, trimOrNull } from '@/components/business/shared';
import { AttributeFields, type RawAttributes } from './attribute-fields';
import { ImageManager, type ImageItem } from './image-manager';
import { VariantsEditor, toVariantDraft, type VariantDraft } from './variants-editor';
import { LISTING_EXTRA_KEYS, ListingExtras, validateListingExtras } from './listing-extras';
import { isHiddenStatus, listingStatusOf } from '@/lib/real-estate/listing/status';
import { CATALOG_BUCKET, VARIANT_INDUSTRIES, type Category, type Product, type Variant } from './types';

interface Props {
  product: Product | null;
  categories: Category[];
  fields: AttributeField[];
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => void;
  onCategoryCreated: (c: Category) => void;
}

function toRaw(attrs: Product['attributes'] | undefined): RawAttributes {
  const out: RawAttributes = {};
  for (const [k, v] of Object.entries(attrs ?? {})) {
    out[k] = typeof v === 'boolean' || Array.isArray(v) ? v : String(v);
  }
  return out;
}

const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));

export function ProductEditor({ product, categories, fields, readOnly, onClose, onSaved, onCategoryCreated }: Props) {
  const t = useT();
  const { workspace, label } = useWorkspace();
  const noun = label('product');
  const [draft, setDraft] = useState({
    name: product?.name ?? '',
    description: product?.description ?? '',
    category_id: product?.category_id ?? '',
    price: product?.price != null ? String(product.price) : '',
    priceOnRequest: product ? product.price == null : false,
    // '' = workspace currency (stored as NULL).
    currency: product?.currency && product.currency !== workspace?.currency ? product.currency : '',
    compare_at_price: product?.compare_at_price != null ? String(product.compare_at_price) : '',
    sku: product?.sku ?? '',
    track_stock: product?.track_stock ?? false,
    stock: product?.stock != null ? String(product.stock) : '',
    is_featured: product?.is_featured ?? false,
    is_active: product?.is_active ?? true,
  });
  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const [tags, setTags] = useState<string[]>(product?.tags ?? []);
  const [tagInput, setTagInput] = useState('');
  const [images, setImages] = useState<ImageItem[]>(() => (product?.images ?? []).map((url) => ({ kind: 'url' as const, url })));
  const [attrs, setAttrs] = useState<RawAttributes>(() => toRaw(product?.attributes));
  const [attrErrors, setAttrErrors] = useState<Record<string, string>>({});
  const [variants, setVariants] = useState<VariantDraft[]>([]);
  const [loadedVariantIds, setLoadedVariantIds] = useState<string[]>([]);
  const [hasVariants, setHasVariants] = useState(false);
  const [newCat, setNewCat] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const variantsDefault = VARIANT_INDUSTRIES.includes(workspace?.industry ?? '');
  // Real estate: map / media / public link get their own section, and
  // sold or rented listings are always inactive (DB trigger, migration 036).
  const isRealEstate = workspace?.industry === 'real_estate';
  const gridFields = useMemo(() => (isRealEstate ? fields.filter((f) => !LISTING_EXTRA_KEYS.includes(f.key)) : fields), [fields, isRealEstate]);
  const listingHidden = isRealEstate && isHiddenStatus(listingStatusOf(attrs));
  const priceCurrency = draft.currency || workspace?.currency || '';
  const currencyOptions = useMemo(
    () => [...new Set([...PRODUCT_CURRENCIES, ...(product?.currency ? [product.currency] : [])])].filter((c) => c !== workspace?.currency).sort(),
    [product?.currency, workspace?.currency],
  );

  useEffect(() => {
    if (!product) return;
    let cancelled = false;
    apiJson<{ variants: Variant[] }>(`/api/catalog/products/${product.id}/variants`)
      .catch(() => null)
      .then((data) => {
        if (cancelled || !data) return;
        const list = data.variants;
        setVariants(list.map(toVariantDraft));
        setLoadedVariantIds(list.map((v) => v.id));
        if (list.length) setHasVariants(true);
      });
    return () => {
      cancelled = true;
    };
  }, [product]);

  const showVariants = variantsDefault || hasVariants;
  const sortedCategories = useMemo(() => [...categories].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)), [categories]);

  const addTag = (raw: string) => {
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    setTags((list) => Array.from(new Set([...list, ...parts.map((p) => p.slice(0, 40))])).slice(0, 30));
    setTagInput('');
  };

  const createCategory = async () => {
    const name = (newCat ?? '').trim();
    if (!name || !workspace) return;
    const existing = categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      set('category_id', existing.id);
      setNewCat(null);
      return;
    }
    let data: Category;
    try {
      ({ category: data } = await apiJson<{ category: Category }>('/api/catalog/categories', {
        method: 'POST',
        body: { name: name.slice(0, 80), sort_order: categories.length },
      }));
    } catch (err) {
      toast.error(err instanceof ApiError && err.code === 'duplicate' ? t('catalog.categories.duplicate') : err instanceof Error ? err.message : String(err));
      return;
    }
    onCategoryCreated(data);
    set('category_id', data.id);
    setNewCat(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly || !workspace) return;

    const errs: Record<string, string> = {};
    if (!draft.name.trim()) errs.name = t('catalog.error.nameRequired');
    const price = draft.priceOnRequest ? null : numOrNull(draft.price);
    if (!draft.priceOnRequest && (price === null || !(price >= 0))) errs.price = t('catalog.error.price');
    const compare = numOrNull(draft.compare_at_price);
    if (compare !== null && !(compare >= 0)) errs.compare_at_price = t('catalog.error.price');
    const stock = draft.track_stock ? numOrNull(draft.stock) : null;
    if (draft.track_stock && (stock === null || !Number.isInteger(stock) || stock < 0)) errs.stock = t('catalog.error.stock');
    const validated = validateAttributes(fields, attrs);
    const { values } = validated;
    const aErrs = isRealEstate ? { ...validated.errors, ...validateListingExtras(attrs) } : validated.errors;
    const variantRows = showVariants ? variants : [];
    for (const v of variantRows) {
      const vp = numOrNull(v.price);
      const vs = numOrNull(v.stock);
      if (!v.name.trim() || (vp !== null && !(vp >= 0)) || (draft.track_stock && vs !== null && !(Number.isInteger(vs) && vs >= 0))) {
        errs.variants = t('catalog.error.variants');
      }
    }
    setErrors(errs);
    setAttrErrors(aErrs);
    if (Object.keys(errs).length || Object.keys(aErrs).length) {
      toast.error(t('catalog.error.fixFields'));
      return;
    }

    setSaving(true);
    const uploaded: string[] = [];
    try {
      // 1. Upload new images (public catalog URLs).
      const urls: string[] = [];
      for (const img of images) {
        if (img.kind === 'url') {
          urls.push(img.url);
          continue;
        }
        try {
          const res = await uploadFile(CATALOG_BUCKET, img.file, { folder: 'products' });
          uploaded.push(res.path);
          urls.push(res.url);
        } catch (err) {
          throw new Error(t('catalog.images.uploadFailed', { reason: err instanceof Error ? err.message : String(err) }));
        }
      }

      // 2. Product row + variants (deleted / updated / inserted) in one request.
      // The route also removes storage objects of images that were dropped.
      const row = {
        name: draft.name.trim().slice(0, 200),
        description: trimOrNull(draft.description),
        category_id: draft.category_id || null,
        price,
        currency: draft.currency || null,
        compare_at_price: compare,
        sku: trimOrNull(draft.sku),
        track_stock: draft.track_stock,
        stock,
        is_featured: draft.is_featured,
        is_active: draft.is_active && !listingHidden,
        tags,
        images: urls,
        attributes: values,
      };
      const keepIds = variantRows.filter((v) => v.id).map((v) => v.id!);
      const variantPayload = variantRows.map((v, i) => ({
        id: v.id ?? null,
        name: v.name.trim().slice(0, 120),
        options: Object.fromEntries(v.options.filter((o) => o.k.trim() && o.v.trim()).map((o) => [o.k.trim().toLowerCase(), o.v.trim()])),
        sku: trimOrNull(v.sku),
        price: numOrNull(v.price),
        stock: draft.track_stock ? numOrNull(v.stock) : null,
        is_active: v.is_active,
        sort_order: i,
      }));
      try {
        if (product) {
          await apiJson(`/api/catalog/products/${product.id}`, {
            method: 'PATCH',
            body: { product: row, variants: variantPayload, removed_variant_ids: loadedVariantIds.filter((id) => !keepIds.includes(id)) },
          });
        } else {
          await apiJson('/api/catalog/products', { method: 'POST', body: { product: row, variants: variantPayload } });
        }
      } catch (err) {
        throw new Error(err instanceof ApiError && err.code === 'sku_taken' ? t('catalog.error.skuTaken') : err instanceof Error ? err.message : String(err));
      }

      await invalidateAi();
      toast.success(t('catalog.saved'));
      onSaved();
    } catch (err) {
      if (uploaded.length && !product) {
        await apiJson('/api/catalog/images', { method: 'DELETE', body: { paths: uploaded } }).catch(() => undefined);
      }
      toast.error(err instanceof Error ? err.message : t('catalog.error.generic'));
    } finally {
      setSaving(false);
    }
  };

  const fieldError = (k: string) =>
    errors[k] ? (
      <p id={`pe-${k}-err`} className="text-xs text-destructive">
        {errors[k]}
      </p>
    ) : null;

  const title = product ? (readOnly ? product.name : t('catalog.editItem', { item: product.name })) : t('catalog.newItem', { item: noun.toLowerCase() });

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full! flex-col gap-0 sm:max-w-2xl!">
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <SheetHeader className="border-b border-border pr-12">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{t('catalog.editor.description', { item: noun.toLowerCase() })}</SheetDescription>
          </SheetHeader>

          <div className="grid flex-1 content-start gap-6 overflow-y-auto px-4 py-5">
            <section className="grid gap-4" aria-labelledby="pe-sec-basic">
              <h3 id="pe-sec-basic" className="text-sm font-semibold text-foreground">
                {t('catalog.editor.basics')}
              </h3>
              <div className="grid gap-1.5">
                <Label htmlFor="pe-name">
                  {t('catalog.field.name')}
                  <span className="text-destructive" aria-hidden> *</span>
                </Label>
                <Input
                  id="pe-name"
                  required
                  maxLength={200}
                  value={draft.name}
                  disabled={readOnly}
                  aria-invalid={!!errors.name}
                  aria-describedby={errors.name ? 'pe-name-err' : undefined}
                  onChange={(e) => set('name', e.target.value)}
                />
                {fieldError('name')}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pe-desc">{t('catalog.field.description')}</Label>
                <Textarea
                  id="pe-desc"
                  rows={4}
                  maxLength={4000}
                  value={draft.description}
                  disabled={readOnly}
                  onChange={(e) => set('description', e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pe-cat">{t('catalog.field.category')}</Label>
                {newCat === null ? (
                  <div className="flex gap-2">
                    <select
                      id="pe-cat"
                      className={selectClass}
                      value={draft.category_id}
                      disabled={readOnly}
                      onChange={(e) => set('category_id', e.target.value)}
                    >
                      <option value="">{t('catalog.uncategorized')}</option>
                      {sortedCategories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {!c.is_active ? ` (${t('catalog.inactive')})` : ''}
                        </option>
                      ))}
                    </select>
                    {!readOnly && (
                      <Button type="button" variant="outline" className="h-9 shrink-0" onClick={() => setNewCat('')}>
                        <Plus className="size-4" />
                        {t('catalog.categories.new')}
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      id="pe-cat"
                      autoFocus
                      maxLength={80}
                      placeholder={t('catalog.categories.namePlaceholder')}
                      value={newCat}
                      onChange={(e) => setNewCat(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void createCategory();
                        } else if (e.key === 'Escape') {
                          e.stopPropagation();
                          setNewCat(null);
                        }
                      }}
                    />
                    <Button type="button" size="icon" className="size-9 shrink-0" aria-label={t('catalog.categories.create')} onClick={createCategory}>
                      <Check className="size-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0" aria-label={t('catalog.cancel')} onClick={() => setNewCat(null)}>
                      <X className="size-4" />
                    </Button>
                  </div>
                )}
              </div>
            </section>

            <section className="grid gap-4" aria-labelledby="pe-sec-price">
              <h3 id="pe-sec-price" className="text-sm font-semibold text-foreground">
                {t('catalog.editor.pricing')}
              </h3>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <Switch checked={draft.priceOnRequest} disabled={readOnly} onCheckedChange={(v) => set('priceOnRequest', v)} />
                {t('catalog.field.priceOnRequest')}
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="pe-price">
                    {t('catalog.field.price')} ({priceCurrency})
                  </Label>
                  <Input
                    id="pe-price"
                    type="number"
                    min={0}
                    step="any"
                    value={draft.priceOnRequest ? '' : draft.price}
                    disabled={readOnly || draft.priceOnRequest}
                    placeholder={draft.priceOnRequest ? t('catalog.priceOnRequest') : ''}
                    aria-invalid={!!errors.price}
                    aria-describedby={errors.price ? 'pe-price-err' : undefined}
                    onChange={(e) => set('price', e.target.value)}
                  />
                  {fieldError('price')}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="pe-currency">{t('catalog.field.currency')}</Label>
                  <select
                    id="pe-currency"
                    className={selectClass}
                    value={draft.currency}
                    disabled={readOnly}
                    aria-describedby="pe-currency-hint"
                    onChange={(e) => set('currency', e.target.value)}
                  >
                    <option value="">{t('catalog.field.currencyDefault', { currency: workspace?.currency ?? '' })}</option>
                    {currencyOptions.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <p id="pe-currency-hint" className="text-xs text-muted-foreground">
                    {t('catalog.field.currencyHint')}
                  </p>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="pe-compare">{t('catalog.field.compareAtPrice')}</Label>
                  <Input
                    id="pe-compare"
                    type="number"
                    min={0}
                    step="any"
                    value={draft.compare_at_price}
                    disabled={readOnly}
                    aria-invalid={!!errors.compare_at_price}
                    aria-describedby="pe-compare-hint"
                    onChange={(e) => set('compare_at_price', e.target.value)}
                  />
                  <p id="pe-compare-hint" className="text-xs text-muted-foreground">
                    {t('catalog.field.compareAtPriceHint')}
                  </p>
                  {fieldError('compare_at_price')}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="pe-sku">SKU</Label>
                  <Input id="pe-sku" maxLength={80} value={draft.sku} disabled={readOnly} onChange={(e) => set('sku', e.target.value)} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
                  <Switch checked={draft.track_stock} disabled={readOnly} onCheckedChange={(v) => set('track_stock', v)} />
                  {t('catalog.field.trackStock')}
                </label>
                {draft.track_stock && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="pe-stock">{t('catalog.field.stock')}</Label>
                    <Input
                      id="pe-stock"
                      type="number"
                      min={0}
                      step={1}
                      value={draft.stock}
                      disabled={readOnly}
                      aria-invalid={!!errors.stock}
                      aria-describedby={errors.stock ? 'pe-stock-err' : undefined}
                      onChange={(e) => set('stock', e.target.value)}
                    />
                    {fieldError('stock')}
                  </div>
                )}
              </div>
            </section>

            <section className="grid gap-3" aria-labelledby="pe-sec-images">
              <h3 id="pe-sec-images" className="text-sm font-semibold text-foreground">
                {t('catalog.editor.images')}
              </h3>
              <ImageManager images={images} readOnly={readOnly} onChange={setImages} />
            </section>

            {fields.length > 0 && (
              <section className="grid gap-3" aria-labelledby="pe-sec-attrs">
                <h3 id="pe-sec-attrs" className="text-sm font-semibold text-foreground">
                  {t('catalog.editor.attributes')}
                </h3>
                <AttributeFields
                  fields={gridFields}
                  values={attrs}
                  errors={attrErrors}
                  readOnly={readOnly}
                  onChange={(k, v) => {
                    // Back from sold/rented: show the listing as active again (the DB does the same).
                    if (isRealEstate && k === 'listing_status' && typeof v === 'string' && !isHiddenStatus(listingStatusOf({ listing_status: v })) && listingHidden) set('is_active', true);
                    setAttrs((a) => ({ ...a, [k]: v }));
                    setAttrErrors((e) => {
                      if (!e[k]) return e;
                      const next = { ...e };
                      delete next[k];
                      return next;
                    });
                  }}
                />
              </section>
            )}

            {isRealEstate && (
              <section className="grid gap-3" aria-labelledby="pe-sec-listing">
                <h3 id="pe-sec-listing" className="text-sm font-semibold text-foreground">
                  {t('realestate.listing.section')}
                </h3>
                <ListingExtras
                  fields={fields}
                  values={attrs}
                  errors={attrErrors}
                  readOnly={readOnly}
                  name={draft.name}
                  productId={product?.id ?? null}
                  isActive={(product?.is_active ?? false) && draft.is_active && !listingHidden}
                  workspaceSlug={workspace?.slug ?? null}
                  onChange={(k, v) => {
                    setAttrs((a) => ({ ...a, [k]: v }));
                    setAttrErrors((e) => {
                      if (!e[k] && !(k === 'latitude' || k === 'longitude')) return e;
                      const next = { ...e };
                      delete next[k];
                      if (k === 'latitude' || k === 'longitude') {
                        delete next.latitude;
                        delete next.longitude;
                      }
                      return next;
                    });
                  }}
                />
              </section>
            )}

            <section className="grid gap-3" aria-labelledby="pe-sec-tags">
              <h3 id="pe-sec-tags" className="text-sm font-semibold text-foreground">
                {t('catalog.field.tags')}
              </h3>
              <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input p-2">
                {tags.map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                    {tag}
                    {!readOnly && (
                      <button type="button" aria-label={t('catalog.removeTag', { tag })} onClick={() => setTags((l) => l.filter((x) => x !== tag))}>
                        <X className="size-3" />
                      </button>
                    )}
                  </span>
                ))}
                {!readOnly && (
                  <input
                    aria-label={t('catalog.field.tags')}
                    placeholder={t('catalog.tagsPlaceholder')}
                    className="min-w-32 flex-1 bg-transparent text-sm outline-none"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onBlur={() => addTag(tagInput)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        addTag(tagInput);
                      } else if (e.key === 'Backspace' && !tagInput && tags.length) {
                        setTags((l) => l.slice(0, -1));
                      }
                    }}
                  />
                )}
                {readOnly && tags.length === 0 && <span className="text-sm text-muted-foreground">—</span>}
              </div>
            </section>

            <section className="grid gap-3" aria-labelledby="pe-sec-variants">
              <div className="flex items-center justify-between gap-3">
                <h3 id="pe-sec-variants" className="text-sm font-semibold text-foreground">
                  {t('catalog.variants.title')}
                </h3>
                {!variantsDefault && (
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Switch
                      checked={hasVariants}
                      disabled={readOnly}
                      aria-label={t('catalog.variants.toggle')}
                      onCheckedChange={setHasVariants}
                    />
                    {t('catalog.variants.toggle')}
                  </label>
                )}
              </div>
              {showVariants && (
                <>
                  <p className="text-xs text-muted-foreground">{t('catalog.variants.hint')}</p>
                  <VariantsEditor
                    variants={variants}
                    readOnly={readOnly}
                    currency={priceCurrency}
                    trackStock={draft.track_stock}
                    onChange={setVariants}
                  />
                  {errors.variants && <p className="text-xs text-destructive">{errors.variants}</p>}
                </>
              )}
            </section>

            <section className="grid gap-3 sm:grid-cols-2" aria-label={t('catalog.editor.visibility')}>
              <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <span>
                  <span className="block text-sm font-medium text-foreground">{t('catalog.field.active')}</span>
                  <span className="block text-xs text-muted-foreground">
                    {listingHidden ? t('realestate.listing.hiddenHint') : t('catalog.field.activeHint')}
                  </span>
                </span>
                <Switch
                  checked={draft.is_active && !listingHidden}
                  disabled={readOnly || listingHidden}
                  onCheckedChange={(v) => set('is_active', v)}
                />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <span>
                  <span className="block text-sm font-medium text-foreground">{t('catalog.field.featured')}</span>
                  <span className="block text-xs text-muted-foreground">{t('catalog.field.featuredHint')}</span>
                </span>
                <Switch checked={draft.is_featured} disabled={readOnly} onCheckedChange={(v) => set('is_featured', v)} />
              </label>
            </section>
          </div>

          <SheetFooter className="flex-row justify-end border-t border-border">
            <Button type="button" variant="outline" onClick={onClose}>
              {readOnly ? t('catalog.close') : t('catalog.cancel')}
            </Button>
            {!readOnly && (
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                {t('catalog.save')}
              </Button>
            )}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

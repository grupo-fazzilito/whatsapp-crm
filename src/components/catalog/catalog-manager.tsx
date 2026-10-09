'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import {
  ChevronLeft,
  ChevronRight,
  FolderTree,
  ImageOff,
  LayoutGrid,
  List,
  Package,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useI18n, useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { apiJson, qs } from '@/lib/crm/api-client';
import { formatMoney } from '@/lib/workspace/countries';
import { productAttributesFor } from '@/lib/catalog/attributes';
import type { AttributeField } from '@/lib/industries';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { EmptyState, LoadingBlock, Notice, PageHeader, invalidateAi, moneyLocale, selectClass } from '@/components/business/shared';
import { ProductEditor } from './product-editor';
import { CategoriesDialog } from './categories-dialog';
import { CatalogImportDialog } from './import/catalog-import-dialog';
import { ListingStatusBadge } from './listing-extras';
import { ListingPublicSettings } from './listing-public-settings';
import { listingStatusOf } from '@/lib/real-estate/listing/status';
import { PAGE_SIZE, formatAttribute, type Category, type Product } from './types';

type View = 'grid' | 'list';
type Status = 'all' | 'active' | 'inactive';
const VIEW_KEY = 'catalog:view';
const VIEW_EVENT = 'catalog:view-change';

// Grid/list preference, remembered per browser.
let sessionView: View | null = null;
function readView(): View {
  if (sessionView) return sessionView;
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}
function subscribeView(cb: () => void) {
  window.addEventListener(VIEW_EVENT, cb);
  return () => window.removeEventListener(VIEW_EVENT, cb);
}

interface CategoryRow extends Category {
  products?: { count: number }[];
}

export function CatalogManager() {
  const t = useT();
  const { locale } = useI18n();
  const { workspace, can, label, modules } = useWorkspace();
  const isAdmin = can('admin');
  const noun = label('product');
  const plural = label('productPlural');

  const fields = useMemo(
    () => (workspace ? productAttributesFor(workspace.industry, workspace.settings) : []),
    [workspace],
  );
  const quickFilters = useMemo(
    () => fields.filter((f) => f.filterable && (f.type === 'select' || f.type === 'multiselect' || f.type === 'boolean')),
    [fields],
  );

  const view = useSyncExternalStore(subscribeView, readView, () => 'grid' as View);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [hasAny, setHasAny] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState<Status>('all');
  const [featured, setFeatured] = useState(false);
  const [inStock, setInStock] = useState(false);
  const [attrFilters, setAttrFilters] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Product | null | undefined>(undefined);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleting, setDeleting] = useState<Product[] | null>(null);
  const [bulkCategory, setBulkCategory] = useState('');

  const changeView = (v: View) => {
    sessionView = v;
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* storage unavailable */
    }
    window.dispatchEvent(new Event(VIEW_EVENT));
  };

  // Debounce the search box.
  useEffect(() => {
    const id = setTimeout(() => setQuery(queryInput.trim()), 300);
    return () => clearTimeout(id);
  }, [queryInput]);

  // Any filter change goes back to the first page.
  const filterKey = JSON.stringify([query, category, status, featured, inStock, attrFilters]);
  const [pageState, setPageState] = useState({ key: filterKey, page: 0 });
  const page = pageState.key === filterKey ? pageState.page : 0;
  const setPage = (fn: (p: number) => number) => setPageState({ key: filterKey, page: fn(page) });

  const loadCategories = useCallback(async () => {
    try {
      const { categories: rows } = await apiJson<{ categories: CategoryRow[] }>('/api/catalog/categories');
      setCategories(rows ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setCategories([]);
    }
  }, []);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const activeAttrs = Object.fromEntries(Object.entries(attrFilters).filter(([k, v]) => v && fields.some((f) => f.key === k)));
      const { products: rows, total: count } = await apiJson<{ products: Product[]; total: number }>(
        `/api/catalog/products${qs({
          page,
          q: query,
          category,
          status: status === 'all' ? '' : status,
          featured,
          in_stock: inStock,
          attrs: Object.keys(activeAttrs).length ? JSON.stringify(activeAttrs) : '',
        })}`,
      );
      setProducts(rows ?? []);
      setSelected(new Set());
      setTotal(count ?? 0);
      if (count) setHasAny(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [page, query, category, status, featured, inStock, attrFilters, fields]);

  // Whether the catalog has anything at all (for the empty state).
  const checkAny = useCallback(async () => {
    const { total: count } = await apiJson<{ total: number }>('/api/catalog/products?count_only=1').catch(() => ({ total: 0 }));
    setHasAny(!!count);
  }, []);

  useEffect(() => {
    if (!workspace) return;
    loadCategories();
    checkAny();
  }, [workspace, loadCategories, checkAny]);

  useEffect(() => {
    if (workspace) loadProducts();
  }, [workspace, loadProducts]);

  const reloadAll = () => {
    loadProducts();
    loadCategories();
    checkAny();
  };

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const counts = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c.products?.[0]?.count ?? 0])), [categories]);
  const filtersOn =
    !!query || !!category || status !== 'all' || featured || inStock || Object.values(attrFilters).some(Boolean);
  const clearFilters = () => {
    setQueryInput('');
    setQuery('');
    setCategory('');
    setStatus('all');
    setFeatured(false);
    setInStock(false);
    setAttrFilters({});
  };

  // Each product in its own currency (NULL = the workspace's).
  const money = (n: number, cur?: string | null) => formatMoney(n, cur || workspace?.currency || 'USD', moneyLocale(locale, workspace?.country));
  const yes = t('catalog.yes');
  const isRealEstate = workspace?.industry === 'real_estate';
  // Real estate: the status has its own badge, so skip it in the attribute chips.
  const chipFields = isRealEstate ? fields.filter((f) => f.key !== 'listing_status') : fields;
  const keyAttributes = (p: Product) =>
    chipFields
      .map((f) => formatAttribute(f, p.attributes?.[f.key], locale, yes))
      .filter((s): s is string => !!s)
      .slice(0, 3);

  // ---- bulk actions -------------------------------------------------------
  const selectedIds = [...selected];
  const allSelected = products.length > 0 && products.every((p) => selected.has(p.id));
  const toggleOne = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(products.map((p) => p.id)));

  const bulkUpdate = async (patch: Partial<Pick<Product, 'is_active' | 'category_id'>>) => {
    if (!selectedIds.length) return;
    try {
      await apiJson('/api/catalog/products', { method: 'PATCH', body: { ids: selectedIds, patch } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return;
    }
    toast.success(t('catalog.bulk.done', { count: selectedIds.length }));
    await invalidateAi();
    reloadAll();
  };

  const removeProducts = async () => {
    if (!deleting?.length) return;
    // The route also removes the products' catalog images.
    try {
      await apiJson('/api/catalog/products', { method: 'DELETE', body: { ids: deleting.map((p) => p.id) } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return;
    }
    toast.success(t('catalog.deleted'));
    await invalidateAi();
    reloadAll();
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ---- render helpers -----------------------------------------------------
  const priceView = (p: Product) =>
    p.price == null ? (
      <span className="text-sm text-muted-foreground">{t('catalog.priceOnRequest')}</span>
    ) : (
      <span className="flex flex-wrap items-baseline gap-1.5">
        <span className="font-semibold text-foreground">{money(Number(p.price), p.currency)}</span>
        {p.compare_at_price != null && Number(p.compare_at_price) > Number(p.price) && (
          <s className="text-xs text-muted-foreground">
            <span className="sr-only">{t('catalog.before')} </span>
            {money(Number(p.compare_at_price), p.currency)}
          </s>
        )}
      </span>
    );

  const stockView = (p: Product) =>
    !p.track_stock ? (
      <span className="text-xs text-muted-foreground">{t('catalog.stock.untracked')}</span>
    ) : (p.stock ?? 0) <= 0 ? (
      <Badge variant="destructive">{t('catalog.stock.out')}</Badge>
    ) : (
      <Badge variant="secondary">{t('catalog.stock.available', { count: p.stock ?? 0 })}</Badge>
    );

  const selectBox = (p: Product) =>
    isAdmin ? (
      <input
        type="checkbox"
        className="size-4 cursor-pointer accent-[var(--primary)]"
        checked={selected.has(p.id)}
        onChange={() => toggleOne(p.id)}
        aria-label={t('catalog.select', { name: p.name })}
      />
    ) : null;

  const filterSelect = (f: AttributeField) => (
    <select
      key={f.key}
      className={cn(selectClass, 'w-auto min-w-36')}
      aria-label={f.label[locale]}
      value={attrFilters[f.key] ?? ''}
      onChange={(e) => setAttrFilters((m) => ({ ...m, [f.key]: e.target.value }))}
    >
      <option value="">
        {f.label[locale]}: {t('catalog.filter.any')}
      </option>
      {f.type === 'boolean' ? (
        <>
          <option value="true">
            {f.label[locale]}: {t('catalog.yes')}
          </option>
          <option value="false">
            {f.label[locale]}: {t('catalog.no')}
          </option>
        </>
      ) : (
        f.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label[locale]}
          </option>
        ))
      )}
    </select>
  );

  const newButton = isAdmin && (
    <Button onClick={() => setEditing(null)}>
      <Plus className="size-4" />
      {t('catalog.newItem', { item: noun.toLowerCase() })}
    </Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={plural}
        description={t('catalog.description', { products: plural.toLowerCase() })}
        actions={
          isAdmin && (
            <>
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="size-4" />
                {t('catalog.import')}
              </Button>
              <ListingPublicSettings />
              <Button variant="outline" onClick={() => setCategoriesOpen(true)}>
                <FolderTree className="size-4" />
                {t('catalog.categories.button')}
              </Button>
              {newButton}
            </>
          )
        }
      />
      {!isAdmin && <Notice>{t('catalog.readOnly')}</Notice>}
      {!modules.products && <Notice>{t('catalog.moduleOff', { module: plural })}</Notice>}

      {hasAny === false && !filtersOn ? (
        <EmptyState
          icon={<Package className="size-6" />}
          title={t('catalog.emptyTitle', { products: plural.toLowerCase() })}
          description={t('catalog.emptyDescription', { products: plural.toLowerCase() })}
          action={
            isAdmin && (
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="outline" onClick={() => setImportOpen(true)}>
                  <Upload className="size-4" />
                  {t('catalog.import')}
                </Button>
                {newButton}
              </div>
            )
          }
        />
      ) : (
        <>
          {/* Filters */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-48 max-w-sm flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8"
                  type="search"
                  placeholder={t('catalog.searchPlaceholder')}
                  aria-label={t('catalog.searchPlaceholder')}
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                />
              </div>
              <select
                className={cn(selectClass, 'w-auto min-w-40')}
                aria-label={t('catalog.field.category')}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">{t('catalog.filter.allCategories')}</option>
                <option value="none">{t('catalog.uncategorized')}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                className={cn(selectClass, 'w-auto')}
                aria-label={t('catalog.filter.status')}
                value={status}
                onChange={(e) => setStatus(e.target.value as Status)}
              >
                <option value="all">{t('catalog.filter.allStatus')}</option>
                <option value="active">{t('catalog.filter.active')}</option>
                <option value="inactive">{t('catalog.filter.inactive')}</option>
              </select>
              <Button variant={featured ? 'default' : 'outline'} aria-pressed={featured} onClick={() => setFeatured((v) => !v)} className="h-9">
                <Star className="size-4" />
                {t('catalog.filter.featured')}
              </Button>
              <Button variant={inStock ? 'default' : 'outline'} aria-pressed={inStock} onClick={() => setInStock((v) => !v)} className="h-9">
                {t('catalog.filter.inStock')}
              </Button>
              <div className="ml-auto flex rounded-lg border border-border p-0.5" role="group" aria-label={t('catalog.view.label')}>
                <Button
                  variant={view === 'grid' ? 'secondary' : 'ghost'}
                  size="icon-sm"
                  aria-pressed={view === 'grid'}
                  aria-label={t('catalog.view.grid')}
                  onClick={() => changeView('grid')}
                >
                  <LayoutGrid className="size-4" />
                </Button>
                <Button
                  variant={view === 'list' ? 'secondary' : 'ghost'}
                  size="icon-sm"
                  aria-pressed={view === 'list'}
                  aria-label={t('catalog.view.list')}
                  onClick={() => changeView('list')}
                >
                  <List className="size-4" />
                </Button>
              </div>
            </div>
            {(quickFilters.length > 0 || filtersOn) && (
              <div className="flex flex-wrap items-center gap-2">
                {quickFilters.map(filterSelect)}
                {filtersOn && (
                  <Button variant="ghost" size="sm" onClick={clearFilters}>
                    <X className="size-3.5" />
                    {t('catalog.filter.clear')}
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Bulk bar */}
          {isAdmin && products.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={allSelected} onChange={toggleAll} />
                {selected.size ? t('catalog.bulk.selected', { count: selected.size }) : t('catalog.bulk.selectAll')}
              </label>
              {selected.size > 0 && (
                <>
                  <span className="mx-1 h-5 w-px bg-border" aria-hidden />
                  <Button size="sm" variant="outline" onClick={() => bulkUpdate({ is_active: true })}>
                    {t('catalog.bulk.activate')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => bulkUpdate({ is_active: false })}>
                    {t('catalog.bulk.deactivate')}
                  </Button>
                  <select
                    className={cn(selectClass, 'h-7 w-auto text-xs')}
                    aria-label={t('catalog.bulk.changeCategory')}
                    value={bulkCategory}
                    onChange={(e) => {
                      const v = e.target.value;
                      setBulkCategory('');
                      if (v) bulkUpdate({ category_id: v === 'none' ? null : v });
                    }}
                  >
                    <option value="">{t('catalog.bulk.changeCategory')}</option>
                    <option value="none">{t('catalog.uncategorized')}</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive"
                    onClick={() => setDeleting(products.filter((p) => selected.has(p.id)))}
                  >
                    <Trash2 className="size-3.5" />
                    {t('catalog.delete')}
                  </Button>
                </>
              )}
            </div>
          )}

          {loading && products.length === 0 ? (
            <LoadingBlock />
          ) : products.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">{t('catalog.noResults')}</p>
          ) : view === 'grid' ? (
            <ul className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4', loading && 'opacity-60')} aria-busy={loading}>
              {products.map((p) => {
                const cat = p.category_id ? catById.get(p.category_id) : null;
                const variantsCount = p.product_variants?.[0]?.count ?? 0;
                return (
                  <li
                    key={p.id}
                    className={cn(
                      'group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-md',
                      selected.has(p.id) && 'ring-2 ring-primary',
                    )}
                  >
                    <div className="relative aspect-[4/3] bg-muted">
                      {p.images[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.images[0]} alt="" loading="lazy" className={cn('size-full object-cover', !p.is_active && 'opacity-50 grayscale')} />
                      ) : (
                        <span className="flex size-full items-center justify-center text-muted-foreground">
                          <ImageOff className="size-8" aria-hidden />
                        </span>
                      )}
                      <span className="absolute left-2 top-2 z-10 flex items-center gap-1.5">
                        {isAdmin && (
                          <span className="rounded bg-background/90 p-1 shadow-sm">
                            {selectBox(p)}
                          </span>
                        )}
                        {p.is_featured && (
                          <span className="inline-flex items-center gap-1 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                            <Star className="size-3" aria-hidden />
                            {t('catalog.featured')}
                          </span>
                        )}
                        {isRealEstate && <ListingStatusBadge status={listingStatusOf(p.attributes)} />}
                        {!p.is_active && (
                          <span className="rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                            {t('catalog.inactive')}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="flex flex-1 flex-col gap-2 p-3">
                      <button
                        type="button"
                        onClick={() => setEditing(p)}
                        className="text-left font-medium text-foreground after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:rounded-xl"
                      >
                        <span className="line-clamp-2">{p.name}</span>
                      </button>
                      {priceView(p)}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {cat && <Badge variant="outline">{cat.name}</Badge>}
                        {stockView(p)}
                        {variantsCount > 0 && (
                          <span className="text-xs text-muted-foreground">{t('catalog.variants.count', { count: variantsCount })}</span>
                        )}
                      </div>
                      {keyAttributes(p).length > 0 && (
                        <ul className="mt-auto flex flex-wrap gap-1" aria-label={t('catalog.editor.attributes')}>
                          {keyAttributes(p).map((a) => (
                            <li key={a} className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground">
                              {a}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className={cn('overflow-x-auto rounded-xl border border-border', loading && 'opacity-60')} aria-busy={loading}>
              <Table>
                <TableHeader>
                  <TableRow>
                    {isAdmin && (
                      <TableHead className="w-10">
                        <span className="sr-only">{t('catalog.bulk.selectAll')}</span>
                      </TableHead>
                    )}
                    <TableHead>{t('catalog.field.name')}</TableHead>
                    <TableHead className="hidden md:table-cell">{t('catalog.field.category')}</TableHead>
                    <TableHead>{t('catalog.field.price')}</TableHead>
                    <TableHead className="hidden sm:table-cell">{t('catalog.field.stock')}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t('catalog.editor.attributes')}</TableHead>
                    <TableHead className="w-16 text-right">
                      <span className="sr-only">{t('catalog.actions')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((p) => {
                    const cat = p.category_id ? catById.get(p.category_id) : null;
                    return (
                      <TableRow key={p.id} className={cn(!p.is_active && 'opacity-60')} data-state={selected.has(p.id) ? 'selected' : undefined}>
                        {isAdmin && (
                          <TableCell>
                            {selectBox(p)}
                          </TableCell>
                        )}
                        <TableCell className="max-w-xs whitespace-normal">
                          <span className="flex items-center gap-3">
                            <span className="size-10 shrink-0 overflow-hidden rounded-md bg-muted">
                              {p.images[0] ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={p.images[0]} alt="" loading="lazy" className="size-full object-cover" />
                              ) : (
                                <span className="flex size-full items-center justify-center text-muted-foreground">
                                  <ImageOff className="size-4" aria-hidden />
                                </span>
                              )}
                            </span>
                            <span className="min-w-0">
                              <span className="flex items-center gap-1 font-medium text-foreground">
                                {p.is_featured && <Star className="size-3.5 shrink-0 fill-amber-500 text-amber-500" aria-label={t('catalog.featured')} />}
                                <span className="truncate">{p.name}</span>
                              </span>
                              {p.sku && <span className="block text-xs text-muted-foreground">SKU {p.sku}</span>}
                              {isRealEstate && <ListingStatusBadge status={listingStatusOf(p.attributes)} className="mt-0.5" />}
                              {!p.is_active && <span className="block text-xs text-muted-foreground">{t('catalog.inactive')}</span>}
                            </span>
                          </span>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {cat ? <Badge variant="outline">{cat.name}</Badge> : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {priceView(p)}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          {stockView(p)}
                        </TableCell>
                        <TableCell className="hidden max-w-xs whitespace-normal lg:table-cell">
                          <span className="text-xs text-muted-foreground">{keyAttributes(p).join(' · ') || '—'}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={isAdmin ? t('catalog.editItem', { item: p.name }) : t('catalog.viewItem', { item: p.name })}
                              onClick={() => setEditing(p)}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            {isAdmin && (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-destructive"
                                aria-label={t('catalog.deleteItem', { item: p.name })}
                                onClick={() => setDeleting([p])}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            )}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {total > 0 && (
            <nav className="flex items-center justify-between gap-2 text-sm text-muted-foreground" aria-label={t('catalog.pagination')}>
              <span>
                {t('catalog.range', {
                  from: page * PAGE_SIZE + 1,
                  to: Math.min(total, (page + 1) * PAGE_SIZE),
                  total,
                })}
              </span>
              {pages > 1 && (
                <span className="flex items-center gap-1">
                  <Button variant="outline" size="icon-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label={t('catalog.prev')}>
                    <ChevronLeft className="size-4" />
                  </Button>
                  <span className="px-2" aria-current="page">
                    {page + 1} / {pages}
                  </span>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    disabled={page + 1 >= pages}
                    onClick={() => setPage((p) => p + 1)}
                    aria-label={t('catalog.next')}
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </span>
              )}
            </nav>
          )}
        </>
      )}

      {editing !== undefined && (
        <ProductEditor
          key={editing?.id ?? 'new'}
          product={editing}
          categories={categories}
          fields={fields}
          readOnly={!isAdmin}
          onClose={() => setEditing(undefined)}
          onCategoryCreated={() => loadCategories()}
          onSaved={() => {
            setEditing(undefined);
            reloadAll();
          }}
        />
      )}

      {isAdmin && <CatalogImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={reloadAll} />}

      {isAdmin && (
        <CategoriesDialog
          open={categoriesOpen}
          onOpenChange={setCategoriesOpen}
          categories={categories}
          counts={counts}
          onChanged={() => {
            loadCategories();
            loadProducts();
          }}
        />
      )}

      <ConfirmationDialog
        isOpen={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={
          deleting?.length === 1
            ? t('catalog.deleteTitle', { name: deleting[0].name })
            : t('catalog.bulk.deleteTitle', { count: deleting?.length ?? 0, products: plural.toLowerCase() })
        }
        description={t('catalog.deleteDescription')}
        confirmText={t('catalog.delete')}
        cancelText={t('catalog.cancel')}
        variant="destructive"
        onConfirm={removeProducts}
      />
    </div>
  );
}

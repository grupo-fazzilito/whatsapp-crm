-- ============================================================
-- 027 — Product catalog
--
-- One catalog per workspace, shaped by its industry: a store's products,
-- a restaurant's menu, a real-estate agency's listings, an academy's
-- materials... Industry-specific fields live in products.attributes
-- (validated by the app against the industry preset + the workspace's
-- own extra attributes in workspaces.settings.product_attributes).
--
-- Search: products.search is maintained by a trigger (accent-insensitive,
-- language-neutral 'simple' config) and queried by search_products().
-- ============================================================

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- unaccent() is STABLE; wrap it so it can be used in an index-friendly way.
CREATE OR REPLACE FUNCTION public.immutable_unaccent(t TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, extensions
AS $$ SELECT extensions.unaccent('extensions.unaccent'::regdictionary, COALESCE(t, '')) $$;

-- ------------------------------------------------------------
-- Categories
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE DEFAULT public.active_ws(),
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (workspace_id, name)
);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.product_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- Products
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE DEFAULT public.active_ws(),
  category_id UUID REFERENCES public.product_categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  -- NULL price = "ask for price" (e.g. real estate on request).
  price NUMERIC(14,2),
  compare_at_price NUMERIC(14,2),
  sku TEXT,
  -- NULL stock with track_stock=false = unlimited / not tracked.
  stock INTEGER,
  track_stock BOOLEAN NOT NULL DEFAULT false,
  -- Public URLs (Supabase Storage 'catalog' bucket or external).
  images TEXT[] NOT NULL DEFAULT '{}',
  tags TEXT[] NOT NULL DEFAULT '{}',
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  -- Featured products are offered first by the AI.
  is_featured BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  search TSVECTOR,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_sku ON public.products(workspace_id, sku) WHERE sku IS NOT NULL AND sku <> '';
CREATE INDEX IF NOT EXISTS idx_products_ws_active ON public.products(workspace_id, is_active);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_search ON public.products USING GIN (search);
CREATE INDEX IF NOT EXISTS idx_products_attributes ON public.products USING GIN (attributes jsonb_path_ops);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Text of every attribute value (strings, numbers, booleans, arrays).
CREATE OR REPLACE FUNCTION public.jsonb_values_text(j JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(string_agg(
    CASE jsonb_typeof(v)
      WHEN 'array' THEN (SELECT string_agg(e #>> '{}', ' ') FROM jsonb_array_elements(v) e)
      ELSE v #>> '{}'
    END, ' '), '')
  FROM jsonb_each(COALESCE(j, '{}'::jsonb)) AS x(k, v)
$$;

CREATE OR REPLACE FUNCTION public.products_search_refresh()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  cat TEXT;
BEGIN
  SELECT name INTO cat FROM public.product_categories WHERE id = NEW.category_id;
  NEW.search :=
    setweight(to_tsvector('simple', public.immutable_unaccent(lower(NEW.name))), 'A') ||
    setweight(to_tsvector('simple', public.immutable_unaccent(lower(COALESCE(cat, '') || ' ' || array_to_string(NEW.tags, ' ') || ' ' || COALESCE(NEW.sku, '')))), 'B') ||
    setweight(to_tsvector('simple', public.immutable_unaccent(lower(public.jsonb_values_text(NEW.attributes)))), 'B') ||
    setweight(to_tsvector('simple', public.immutable_unaccent(lower(COALESCE(NEW.description, '')))), 'C');
  RETURN NEW;
END;
$$;
CREATE TRIGGER products_search_refresh BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_search_refresh();

-- ------------------------------------------------------------
-- Variants (size/color/...): own SKU, price and stock
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_variants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- e.g. {"talla": "M", "color": "Rojo"}
  options JSONB NOT NULL DEFAULT '{}'::jsonb,
  sku TEXT,
  -- NULL = product price.
  price NUMERIC(14,2),
  stock INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_variants_product ON public.product_variants(product_id);
CREATE TRIGGER set_ws_from_parent BEFORE INSERT ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.set_ws_from_parent('products', 'product_id');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Bookings can reference a product (e.g. property viewing).
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_product_id_fkey;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- RLS: members read, admins write
-- ------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['product_categories', 'products', 'product_variants'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY ws_member_read ON public.%I FOR SELECT USING (public.ws_access(workspace_id))', t);
    EXECUTE format($p$CREATE POLICY ws_admin_write ON public.%I FOR ALL
      USING (public.ws_access(workspace_id, 'admin')) WITH CHECK (public.ws_access(workspace_id, 'admin'))$p$, t);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- Search
--   q        free text ("depa 2 recamaras roma"), accent-insensitive,
--            prefix matching per word, falls back to ILIKE on name.
--   filters  {"attr": value} exact / any-of for arrays, plus range keys
--            "<attr>__min" / "<attr>__max" for numbers.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_products(
  ws UUID,
  q TEXT DEFAULT NULL,
  category UUID DEFAULT NULL,
  filters JSONB DEFAULT '{}'::jsonb,
  min_price NUMERIC DEFAULT NULL,
  max_price NUMERIC DEFAULT NULL,
  in_stock_only BOOLEAN DEFAULT false,
  max_results INTEGER DEFAULT 10
)
RETURNS SETOF public.products
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  tsq tsquery;
  words TEXT;
  k TEXT;
  v JSONB;
  base TEXT;
  sql TEXT;
BEGIN
  words := trim(regexp_replace(public.immutable_unaccent(lower(COALESCE(q, ''))), '[^a-z0-9ñ ]+', ' ', 'g'));
  IF words <> '' THEN
    tsq := to_tsquery('simple', array_to_string(ARRAY(
      SELECT w || ':*' FROM unnest(string_to_array(words, ' ')) w WHERE length(w) > 1
    ), ' | '));
  END IF;

  sql := 'SELECT p.* FROM public.products p WHERE p.workspace_id = $1 AND p.is_active';
  IF category IS NOT NULL THEN sql := sql || ' AND p.category_id = $2'; END IF;
  IF min_price IS NOT NULL THEN sql := sql || ' AND p.price >= $3'; END IF;
  IF max_price IS NOT NULL THEN sql := sql || ' AND p.price <= $4'; END IF;
  IF in_stock_only THEN sql := sql || ' AND (NOT p.track_stock OR COALESCE(p.stock, 0) > 0)'; END IF;
  IF tsq IS NOT NULL THEN
    sql := sql || ' AND (p.search @@ $5 OR public.immutable_unaccent(lower(p.name)) LIKE ''%'' || $6 || ''%'')';
  END IF;

  FOR k, v IN SELECT * FROM jsonb_each(COALESCE(filters, '{}'::jsonb)) LOOP
    IF k !~ '^[a-z0-9_]+$' THEN CONTINUE; END IF;
    IF k LIKE '%\_\_min' THEN
      base := left(k, length(k) - 5);
      sql := sql || format(' AND (p.attributes->>%L) ~ ''^-?[0-9.]+$'' AND (p.attributes->>%L)::numeric >= %s', base, base, (v #>> '{}')::numeric);
    ELSIF k LIKE '%\_\_max' THEN
      base := left(k, length(k) - 5);
      sql := sql || format(' AND (p.attributes->>%L) ~ ''^-?[0-9.]+$'' AND (p.attributes->>%L)::numeric <= %s', base, base, (v #>> '{}')::numeric);
    ELSIF jsonb_typeof(v) = 'array' THEN
      -- any of the values (attribute may itself be an array)
      sql := sql || format(' AND (p.attributes->%L ?| %L OR (p.attributes->>%L) = ANY (%L))',
        k, ARRAY(SELECT jsonb_array_elements_text(v)), k, ARRAY(SELECT jsonb_array_elements_text(v)));
    ELSE
      sql := sql || format(' AND (lower(p.attributes->>%L) = lower(%L) OR p.attributes->%L ? %L)', k, v #>> '{}', k, v #>> '{}');
    END IF;
  END LOOP;

  sql := sql || ' ORDER BY ' ||
    CASE WHEN tsq IS NOT NULL THEN 'ts_rank(p.search, $5) DESC, ' ELSE '' END ||
    'p.is_featured DESC, p.sort_order, p.name LIMIT $7';

  RETURN QUERY EXECUTE sql USING ws, category, min_price, max_price, tsq, words, LEAST(GREATEST(max_results, 1), 50);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.search_products(UUID, TEXT, UUID, JSONB, NUMERIC, NUMERIC, BOOLEAN, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_products(UUID, TEXT, UUID, JSONB, NUMERIC, NUMERIC, BOOLEAN, INTEGER) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Storage: product images (public read so WhatsApp/Instagram can fetch
-- them; writes limited to admins of the workspace folder).
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('catalog', 'catalog', true, 8388608, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY catalog_admin_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'catalog' AND public.is_ws_member(((storage.foldername(name))[1])::uuid, 'admin'));
CREATE POLICY catalog_admin_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'catalog' AND public.is_ws_member(((storage.foldername(name))[1])::uuid, 'admin'));
CREATE POLICY catalog_admin_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'catalog' AND public.is_ws_member(((storage.foldername(name))[1])::uuid, 'admin'));

NOTIFY pgrst, 'reload schema';

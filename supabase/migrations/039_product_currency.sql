-- ============================================================
-- 039 — Per-product currency
--
-- products.currency  ISO 4217 code; NULL = the workspace currency.
-- Real-estate agencies price sales and rentals in different currencies
-- (Peru: sales in USD, rentals in PEN) inside the same workspace.
--
-- search_products() gains an optional price_currency: when given together
-- with a price bound, only products whose effective currency matches are
-- compared (a "up to 300k USD" budget never matches PEN rentals). Old
-- callers keep working (the parameter defaults to NULL).
-- ============================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS currency TEXT CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$');

DROP FUNCTION IF EXISTS public.search_products(UUID, TEXT, UUID, JSONB, NUMERIC, NUMERIC, BOOLEAN, INTEGER);

CREATE OR REPLACE FUNCTION public.search_products(
  ws UUID,
  q TEXT DEFAULT NULL,
  category UUID DEFAULT NULL,
  filters JSONB DEFAULT '{}'::jsonb,
  min_price NUMERIC DEFAULT NULL,
  max_price NUMERIC DEFAULT NULL,
  in_stock_only BOOLEAN DEFAULT false,
  max_results INTEGER DEFAULT 10,
  price_currency TEXT DEFAULT NULL
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
  -- With a currency, price bounds only apply to products priced in it
  -- (p.currency NULL = the workspace currency).
  IF price_currency IS NOT NULL AND (min_price IS NOT NULL OR max_price IS NOT NULL) THEN
    sql := sql || ' AND COALESCE(p.currency, (SELECT w.currency FROM public.workspaces w WHERE w.id = $1)) = $8';
  END IF;
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

  RETURN QUERY EXECUTE sql USING ws, category, min_price, max_price, tsq, words, LEAST(GREATEST(max_results, 1), 50), upper(price_currency);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.search_products(UUID, TEXT, UUID, JSONB, NUMERIC, NUMERIC, BOOLEAN, INTEGER, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_products(UUID, TEXT, UUID, JSONB, NUMERIC, NUMERIC, BOOLEAN, INTEGER, TEXT) TO authenticated, service_role;

-- Lead match alerts (037): a currency change re-runs matching like a price change.
CREATE OR REPLACE FUNCTION public.enqueue_property_match()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  why TEXT;
BEGIN
  IF NOT NEW.is_active THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = NEW.workspace_id AND w.industry = 'real_estate') THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    why := 'created';
  ELSIF NOT OLD.is_active THEN
    why := 'activated';
  ELSIF NEW.price IS DISTINCT FROM OLD.price OR NEW.currency IS DISTINCT FROM OLD.currency THEN
    why := 'price';
  ELSIF public.listing_status_of(NEW) IS DISTINCT FROM public.listing_status_of(OLD) THEN
    why := 'status';
  ELSE
    RETURN NULL;
  END IF;
  -- Small delay so a listing being edited in several saves alerts once.
  INSERT INTO public.property_match_jobs (workspace_id, product_id, reason, run_after)
  VALUES (NEW.workspace_id, NEW.id, why, NOW() + INTERVAL '2 minutes')
  ON CONFLICT (product_id) WHERE status = 'pending'
  DO UPDATE SET run_after = EXCLUDED.run_after;
  RETURN NULL;
END;
$$;

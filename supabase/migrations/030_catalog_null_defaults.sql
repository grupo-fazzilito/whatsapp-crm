-- ============================================================
-- 030 — Catalog: NULL → defaults on write
--
-- Bulk inserts through PostgREST send NULL for columns that some rows of
-- the batch omit, which violated the NOT NULL array/jsonb columns and
-- rejected the whole batch. Coalesce them to their defaults instead.
-- ============================================================
CREATE OR REPLACE FUNCTION public.products_null_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.images := COALESCE(NEW.images, '{}');
  NEW.tags := COALESCE(NEW.tags, '{}');
  NEW.attributes := COALESCE(NEW.attributes, '{}'::jsonb);
  NEW.track_stock := COALESCE(NEW.track_stock, false);
  NEW.is_active := COALESCE(NEW.is_active, true);
  NEW.is_featured := COALESCE(NEW.is_featured, false);
  NEW.sort_order := COALESCE(NEW.sort_order, 0);
  RETURN NEW;
END;
$$;

-- Runs before products_search_refresh (triggers fire in name order).
DROP TRIGGER IF EXISTS a_products_null_defaults ON public.products;
CREATE TRIGGER a_products_null_defaults BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_null_defaults();

CREATE OR REPLACE FUNCTION public.product_variants_null_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.options := COALESCE(NEW.options, '{}'::jsonb);
  NEW.is_active := COALESCE(NEW.is_active, true);
  NEW.sort_order := COALESCE(NEW.sort_order, 0);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS a_product_variants_null_defaults ON public.product_variants;
CREATE TRIGGER a_product_variants_null_defaults BEFORE INSERT OR UPDATE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.product_variants_null_defaults();

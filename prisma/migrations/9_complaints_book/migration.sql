-- Libro de Reclamaciones virtual (Peru, Código de Protección y Defensa del
-- Consumidor, D.S. 011-2011-PCM and amendments). One row per hoja de
-- reclamación filed on the public site.
--   number     correlative per year, shown as 000001-2026
--   kind       reclamo (about the product or service) | queja (about the service received, not the product)
--   item_type  producto | servicio
--   response   provider's answer, due within 15 business days; emailed to the consumer
-- Kept at least 2 years (no automatic deletion).
CREATE TABLE public.complaints (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  year integer NOT NULL,
  number integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('reclamo', 'queja')),
  consumer_name text NOT NULL,
  doc_type text NOT NULL CHECK (doc_type IN ('dni', 'ce', 'pasaporte', 'ruc')),
  doc_number text NOT NULL,
  address text NOT NULL,
  phone text,
  email text NOT NULL,
  is_minor boolean DEFAULT false NOT NULL,
  guardian_name text,
  item_type text NOT NULL CHECK (item_type IN ('producto', 'servicio')),
  item_description text NOT NULL,
  amount numeric(12,2) CHECK (amount IS NULL OR amount >= 0),
  detail text NOT NULL,
  request text NOT NULL,
  status text DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'answered')),
  response text,
  responded_at timestamptz,
  responded_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  locale text DEFAULT 'es' NOT NULL,
  ip text,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (year, number)
);

CREATE INDEX idx_complaints_status ON public.complaints (status, created_at DESC);

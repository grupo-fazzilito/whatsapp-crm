-- ============================================================
-- 024 — Generic business module + AI routing
--
-- The clinic-only tables become industry-neutral (data preserved):
--   clinics            → merged into workspaces (business profile)
--   clinic_timings     → business_hours
--   doctors            → staff
--   clinic_services    → services (+ staff_services)
--   clinic_faqs        → faqs
--   appointments       → bookings
--   patient_feedback   → feedback
--   ai_chat_logs       keeps its name, scoped by workspace/agent
--   patient_intake     stays (clinic triage module only)
--   ai_settings        dropped (migrated to ai_agents in 022)
--
-- Routing between AI agents:
--   conversations.ai_agent_id   agent handling this conversation; it
--                               overrides the channel's agent.
--   ai_agents.description       what the agent handles (used by router
--                               agents and transfers to choose).
--   ai_agents.transfer_agent_ids  agents it may hand off to.
--   channels.settings.welcome_menu  optional greeting menu that routes
--                               each option to an agent or to humans.
-- ============================================================

-- ------------------------------------------------------------
-- Business profile → workspaces
-- ------------------------------------------------------------
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS date_exceptions JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS business_type_detail TEXT;

UPDATE public.workspaces w SET
  description          = COALESCE(w.description, c.clinic_description),
  business_type_detail = COALESCE(w.business_type_detail, c.clinic_type),
  phone                = COALESCE(w.phone, c.phone, c.whatsapp_number),
  email                = COALESCE(w.email, c.email),
  website              = COALESCE(w.website, c.website),
  address              = COALESCE(w.address, c.address),
  city                 = COALESCE(w.city, c.city),
  state                = COALESCE(w.state, c.state),
  postal_code          = COALESCE(w.postal_code, c.pincode),
  google_map_link      = COALESCE(w.google_map_link, c.google_map_link),
  date_exceptions      = COALESCE(c.date_exceptions, '[]'::jsonb)
FROM public.clinics c
WHERE c.workspace_id = w.id;

-- Workspaces that ran the clinic module keep the clinic preset.
UPDATE public.workspaces w SET industry = 'clinic'
WHERE w.industry = 'generic' AND EXISTS (SELECT 1 FROM public.clinics c WHERE c.workspace_id = w.id);

-- Helper: detach a child table from clinics (trigger + column).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['clinic_timings','doctors','clinic_services','clinic_faqs','appointments',
                           'ai_chat_logs','patient_intake','patient_feedback','ai_settings'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_ws_from_parent ON public.%I', t);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN workspace_id SET DEFAULT public.active_ws()', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- business_hours
-- ------------------------------------------------------------
ALTER TABLE public.clinic_timings RENAME TO business_hours;
ALTER TABLE public.business_hours DROP COLUMN clinic_id;
ALTER TABLE public.business_hours RENAME COLUMN lunch_break_start TO break_start;
ALTER TABLE public.business_hours RENAME COLUMN lunch_break_end TO break_end;
DELETE FROM public.business_hours a USING public.business_hours b
  WHERE a.workspace_id = b.workspace_id AND a.day_name = b.day_name AND a.created_at < b.created_at;
CREATE UNIQUE INDEX IF NOT EXISTS uq_business_hours_day ON public.business_hours(workspace_id, day_name);

-- ------------------------------------------------------------
-- staff
-- ------------------------------------------------------------
ALTER TABLE public.doctors RENAME TO staff;
ALTER TABLE public.staff DROP COLUMN clinic_id;
ALTER TABLE public.staff RENAME COLUMN doctor_name TO name;
ALTER TABLE public.staff RENAME COLUMN specialization TO title;
ALTER TABLE public.staff RENAME COLUMN consultation_fee TO fee;
ALTER TABLE public.staff RENAME COLUMN languages_spoken TO languages;
ALTER TABLE public.staff RENAME COLUMN profile_photo TO photo_url;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
-- Optional link to a CRM user (e.g. the barber also answers chats).
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS member_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- services (+ which staff perform them)
-- ------------------------------------------------------------
ALTER TABLE public.clinic_services RENAME TO services;
ALTER TABLE public.services DROP COLUMN clinic_id;
ALTER TABLE public.services RENAME COLUMN service_name TO name;
ALTER TABLE public.services RENAME COLUMN starting_price TO price;
ALTER TABLE public.services RENAME COLUMN duration TO duration_minutes;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS price_is_from BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.staff_services (
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, service_id)
);
CREATE TRIGGER set_ws_from_parent BEFORE INSERT ON public.staff_services
  FOR EACH ROW EXECUTE FUNCTION public.set_ws_from_parent('staff', 'staff_id');
ALTER TABLE public.staff_services ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_member_read ON public.staff_services FOR SELECT USING (public.ws_access(workspace_id));
CREATE POLICY ws_admin_write ON public.staff_services FOR ALL
  USING (public.ws_access(workspace_id, 'admin')) WITH CHECK (public.ws_access(workspace_id, 'admin'));

-- ------------------------------------------------------------
-- faqs (optionally limited to some agents)
-- ------------------------------------------------------------
ALTER TABLE public.clinic_faqs RENAME TO faqs;
ALTER TABLE public.faqs DROP COLUMN clinic_id;
-- NULL/empty = every agent may use it.
ALTER TABLE public.faqs ADD COLUMN IF NOT EXISTS ai_agent_ids UUID[];

-- ------------------------------------------------------------
-- bookings
-- ------------------------------------------------------------
ALTER TABLE public.appointments RENAME TO bookings;
ALTER TABLE public.bookings DROP COLUMN clinic_id;
ALTER TABLE public.bookings RENAME COLUMN doctor_id TO staff_id;
ALTER TABLE public.bookings RENAME COLUMN appointment_date TO booking_date;
ALTER TABLE public.bookings RENAME COLUMN appointment_time TO booking_time;
ALTER TABLE public.bookings RENAME COLUMN patient_name TO customer_name;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES public.services(id) ON DELETE SET NULL;
-- e.g. the property for a real-estate viewing (products arrive in 025).
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS product_id UUID;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS duration_minutes INTEGER NOT NULL DEFAULT 30;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS party_size INTEGER;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS notes TEXT;
-- Industry-specific answers collected at booking time (age, reason, level...).
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS ai_agent_id UUID REFERENCES public.ai_agents(id) ON DELETE SET NULL;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

UPDATE public.bookings SET custom_fields = jsonb_strip_nulls(jsonb_build_object('age', patient_age, 'reason', reason_for_visit))
WHERE patient_age IS NOT NULL OR reason_for_visit IS NOT NULL;
ALTER TABLE public.bookings DROP COLUMN patient_age;
ALTER TABLE public.bookings DROP COLUMN reason_for_visit;

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS appointments_status_check;
UPDATE public.bookings SET status = 'confirmed' WHERE status = 'scheduled';
ALTER TABLE public.bookings ALTER COLUMN status SET DEFAULT 'confirmed';
ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show'));
CREATE INDEX IF NOT EXISTS idx_bookings_day ON public.bookings(workspace_id, booking_date);
CREATE INDEX IF NOT EXISTS idx_bookings_staff_day ON public.bookings(staff_id, booking_date);

-- ------------------------------------------------------------
-- feedback / intake / chat logs
-- ------------------------------------------------------------
ALTER TABLE public.patient_feedback RENAME TO feedback;
ALTER TABLE public.feedback DROP COLUMN clinic_id;
ALTER TABLE public.feedback RENAME COLUMN appointment_id TO booking_id;

ALTER TABLE public.patient_intake DROP COLUMN clinic_id;
ALTER TABLE public.patient_intake RENAME COLUMN appointment_id TO booking_id;

ALTER TABLE public.ai_chat_logs DROP COLUMN clinic_id;
ALTER TABLE public.ai_chat_logs RENAME COLUMN patient_id TO contact_id;
ALTER TABLE public.ai_chat_logs ADD COLUMN IF NOT EXISTS ai_agent_id UUID REFERENCES public.ai_agents(id) ON DELETE SET NULL;
ALTER TABLE public.ai_chat_logs ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL;
ALTER TABLE public.ai_chat_logs ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES public.channels(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ai_chat_logs_ws_created ON public.ai_chat_logs(workspace_id, created_at DESC);

-- ------------------------------------------------------------
-- Old clinic tables
-- ------------------------------------------------------------
DROP TABLE IF EXISTS public.ai_settings;
DROP TABLE IF EXISTS public.clinics;

-- ------------------------------------------------------------
-- Routing
-- ------------------------------------------------------------
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS ai_agent_id UUID REFERENCES public.ai_agents(id) ON DELETE SET NULL;
ALTER TABLE public.ai_agents ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.ai_agents ADD COLUMN IF NOT EXISTS transfer_agent_ids UUID[] NOT NULL DEFAULT '{}';

NOTIFY pgrst, 'reload schema';

-- Why the last reminder of a booking wasn't sent (no WhatsApp window and no
-- approved template, no credits, send error…). Reminders aren't retried in a
-- loop anymore: the reason is recorded once and shown on the booking.
ALTER TABLE public.bookings ADD COLUMN reminder_error text;

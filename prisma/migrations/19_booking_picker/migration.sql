-- Booking picker: the customer books by tapping (service → day → time)
-- from a flow step or a "Send schedule" button in the inbox, without the
-- AI. The in-progress choice lives on the conversation.
ALTER TABLE public.conversations ADD COLUMN booking_picker jsonb;

-- New flow step "book_appointment".
ALTER TABLE public.flow_nodes DROP CONSTRAINT flow_nodes_node_type_check;
ALTER TABLE public.flow_nodes ADD CONSTRAINT flow_nodes_node_type_check CHECK ((node_type = ANY (ARRAY['start'::text, 'send_buttons'::text, 'send_list'::text, 'send_message'::text, 'collect_input'::text, 'condition'::text, 'set_tag'::text, 'handoff'::text, 'handoff_ai_agent'::text, 'http_fetch'::text, 'book_appointment'::text, 'end'::text])));

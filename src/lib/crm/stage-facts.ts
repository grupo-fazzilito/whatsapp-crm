// Facts that move a customer's deal to a pipeline stage on their own
// (pipeline_stages.ai_events, applied by the crm_fact() database function).
export const STAGE_FACTS = ['booking_created', 'booking_completed', 'order_created', 'order_paid'] as const
export type StageFact = (typeof STAGE_FACTS)[number]

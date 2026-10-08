export interface Profile {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  avatar_url?: string;
  role: string;
  /**
   * Opted-in beta feature keys for this account. The column survives
   * for future beta gates; no current feature reads it (Flows was
   * the last user and went to soft-GA in PR #134). Defaults to `[]`
   * for every profile; toggled per-account via a direct UPDATE on
   * the `profiles` row.
   */
  beta_features?: string[];
  created_at: string;
}

export interface Contact {
  id: string;
  workspace_id: string;
  /** Created by (nullable since workspaces). */
  user_id?: string | null;
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  avatar_url?: string;
  created_at: string;
  updated_at: string;
  /** Embedded by the inbox list query (tag filter "include contact tags"). */
  contact_tags?: { tag_id: string }[];
}

export interface Tag {
  id: string;
  workspace_id: string;
  /** Created by (nullable since workspaces). */
  user_id?: string | null;
  name: string;
  color: string;
  created_at: string;
}

export interface ContactTag {
  id: string;
  workspace_id?: string;
  contact_id: string;
  tag_id: string;
}

export interface CustomField {
  id: string;
  workspace_id: string;
  /** Created by (nullable since workspaces). */
  user_id?: string | null;
  field_name: string;
  field_type: string;
  field_options?: Record<string, unknown>;
  created_at: string;
}

export interface ContactCustomValue {
  id: string;
  workspace_id?: string;
  contact_id: string;
  custom_field_id: string;
  value?: string;
}

export interface ContactNote {
  id: string;
  contact_id: string;
  workspace_id: string;
  /** Created by (nullable since workspaces). */
  user_id?: string | null;
  note_text: string;
  created_at: string;
}

export type ConversationStatus = 'open' | 'pending' | 'closed';

export interface Conversation {
  id: string;
  workspace_id: string;
  /** Created by (nullable since workspaces). */
  user_id?: string | null;
  contact_id: string;
  status: ConversationStatus;
  assigned_agent_id?: string;
  last_message_text?: string;
  last_message_at?: string;
  unread_count: number;
  created_at: string;
  updated_at: string;
  contact?: Contact;
  /** Channel the conversation happens on (channels.id). */
  channel_id?: string | null;
  /** The channel's AI agent stays quiet until this moment (null = active). */
  ai_paused_until?: string | null;
  ai_state?: Record<string, unknown> | null;
  /** AI agent owning the conversation (overrides the channel's). */
  ai_agent_id?: string | null;
  /** Inbox priority (migration 032). */
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  /** Set when the conversation is resolved (status 'closed'). */
  resolved_at?: string | null;
  resolved_by?: string | null;
  /** Team the conversation belongs to (transfers / auto-assignment). */
  team_id?: string | null;
  /** Last inbound customer message (waiting-time sort). */
  last_customer_message_at?: string | null;
  /** Embedded by the inbox list query. */
  conversation_tags?: { id: string; tag_id: string }[];
  /** AI summary as JSON text (migration 040; see src/lib/ai/assist/core.ts). */
  ai_summary?: string | null;
  ai_summary_at?: string | null;
  ai_summary_by?: string | null;
}

export type SenderType = 'customer' | 'agent' | 'bot';
export type ContentType =
  | 'text'
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'location'
  | 'template'
  /** Customer tapped a reply button or list row on a message we sent. */
  | 'interactive'
  | 'sticker'
  | 'system';
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface Message {
  id: string;
  workspace_id?: string;
  conversation_id: string;
  sender_type: SenderType;
  sender_id?: string;
  content_type: ContentType;
  content_text?: string;
  media_url?: string;
  template_name?: string;
  message_id?: string;
  status: MessageStatus;
  created_at: string;
  reply_to_message_id?: string;
  /**
   * Only set when `content_type === 'interactive'` — the stable id of
   * the button or list row the customer tapped. The Flows engine uses
   * this to route the next node; the inbox bubble uses it as a styling
   * cue (renders with a "↩ button reply" affordance).
   */
  interactive_reply_id?: string;
  /** AI agent that wrote this message (bot messages). */
  ai_agent_id?: string | null;
  /**
   * Free-form extras: `error` on failed sends, `options` / `sections`
   * on interactive bot messages.
   */
  metadata?: Record<string, unknown> | null;
  /** Team-only note (never sent to the customer). Migration 032. */
  is_internal?: boolean;
  /** Voice-note transcript (AI assist, migration 040). */
  transcript?: string | null;
  /** AI description / extracted text of an image or PDF (migration 040). */
  ai_media_text?: string | null;
  ai_processed_at?: string | null;
}

/** One way to reach a contact on a channel (contact_identities). */
export interface ContactIdentity {
  id: string;
  workspace_id: string;
  contact_id: string;
  channel_type: 'whatsapp' | 'messenger' | 'instagram' | 'tiktok' | 'webchat';
  external_id: string;
  handle?: string | null;
  created_at?: string;
}

export type ReactionActor = 'customer' | 'agent';

export interface MessageReaction {
  id: string;
  workspace_id?: string;
  message_id: string;
  conversation_id: string;
  actor_type: ReactionActor;
  actor_id?: string;
  emoji: string;
  created_at: string;
}

export interface WhatsAppConfig {
  id: string;
  workspace_id: string;
  /** Created by (nullable since workspaces). */
  user_id?: string | null;
  phone_number_id: string;
  waba_id?: string;
  access_token: string;
  verify_token?: string;
  status: 'connected' | 'disconnected';
  connected_at?: string;
}

export interface MessageTemplate {
  id: string;
  workspace_id: string;
  /** Created by (nullable since workspaces). */
  user_id?: string | null;
  name: string;
  category: 'Marketing' | 'Utility' | 'Authentication';
  language?: string;
  header_type?: 'text' | 'image' | 'video' | 'document';
  header_content?: string;
  body_text: string;
  footer_text?: string;
  buttons?: Record<string, unknown>[];
  status?: 'Draft' | 'Pending' | 'Approved' | 'Rejected';
  created_at: string;
}

export interface Pipeline {
  id: string;
  workspace_id: string;
  /** Created by (nullable since workspaces). */
  user_id?: string | null;
  name: string;
  /** Stable identifier of seeded pipelines, e.g. 'real_estate' (migration 036). */
  key?: string | null;
  created_at: string;
}

export interface PipelineStage {
  id: string;
  workspace_id?: string;
  pipeline_id: string;
  name: string;
  position: number;
  color: string;
  /** Stable stage key of seeded pipelines (e.g. 'viewing_scheduled'). */
  key?: string | null;
  created_at: string;
}

export type DealStatus = 'open' | 'won' | 'lost';

export interface Deal {
  id: string;
  workspace_id: string;
  /** Created by (nullable since workspaces). */
  user_id?: string | null;
  pipeline_id: string;
  stage_id: string;
  /**
   * Nullable after migration 004 — becomes NULL when the referenced
   * contact is deleted (ON DELETE SET NULL). History preserved.
   */
  contact_id: string | null;
  conversation_id?: string;
  assigned_to?: string;
  title: string;
  value: number;
  currency?: string;
  notes?: string;
  expected_close_date?: string;
  status?: DealStatus;
  /** Set by the DB when the deal is marked won / lost (033). */
  won_at?: string | null;
  lost_at?: string | null;
  /** Why it was lost (workspaces.settings.crm.lost_reasons or free text). */
  lost_reason?: string | null;
  /** Optional note entered when closing the deal. */
  close_note?: string | null;
  created_at: string;
  updated_at?: string;
  contact?: Contact;
  stage?: PipelineStage;
  assignee?: Profile;
}

export type BroadcastStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';
export type RecipientStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'replied' | 'failed';

export interface Broadcast {
  id: string;
  workspace_id: string;
  /** Created by (nullable since workspaces). */
  user_id?: string | null;
  name: string;
  template_name: string;
  template_language: string;
  template_variables?: Record<string, unknown>;
  audience_filter?: Record<string, unknown>;
  scheduled_at?: string;
  status: BroadcastStatus;
  total_recipients: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  replied_count: number;
  failed_count: number;
  created_at: string;
}

export interface BroadcastRecipient {
  id: string;
  workspace_id?: string;
  broadcast_id: string;
  /**
   * Nullable after migration 004 — becomes NULL when the referenced
   * contact is deleted (ON DELETE SET NULL). History preserved; the
   * UI renders "Unknown" for orphaned rows.
   */
  contact_id: string | null;
  status: RecipientStatus;
  sent_at?: string;
  delivered_at?: string;
  read_at?: string;
  replied_at?: string;
  error_message?: string;
  /**
   * Meta's message id, persisted when the broadcast send succeeds so
   * the webhook can mirror status updates back onto the recipient row.
   * Added in migration 003.
   */
  whatsapp_message_id?: string;
  created_at: string;
  contact?: Contact;
}

// ============================================================
// Automations (migration 006)
// ============================================================

export type AutomationTriggerType =
  | 'new_message_received'
  | 'first_inbound_message'
  | 'keyword_match'
  | 'new_contact_created'
  | 'conversation_assigned'
  | 'tag_added'
  | 'time_based'
  | 'no_reply';

export type AutomationStepType =
  | 'send_message'
  | 'send_template'
  | 'add_tag'
  | 'remove_tag'
  | 'assign_conversation'
  | 'update_contact_field'
  | 'create_deal'
  | 'wait'
  | 'condition'
  | 'send_webhook'
  | 'close_conversation'
  | 'ai_followup';

export type AutomationLogStatus = 'success' | 'partial' | 'failed';

export interface KeywordMatchTriggerConfig {
  keywords: string[];
  match_type: 'exact' | 'contains';
  case_sensitive?: boolean;
}

export interface TagTriggerConfig {
  tag_id: string;
}

export interface TimeBasedTriggerConfig {
  /** Cron expression or simple HH:mm string; engine can accept either. */
  schedule: string;
  timezone?: string;
}

export type DelayUnit = 'minutes' | 'hours' | 'days';

/** no_reply: we sent a message and the customer has not answered for `after`. */
export interface NoReplyTriggerConfig {
  after: { amount: number; unit: DelayUnit };
  /** Only these channels (empty / missing = all). */
  channel_ids?: string[];
  /** Only conversations an AI agent is handling. */
  only_when_ai?: boolean;
  /** Only conversations handled by people (AI paused or no agent). */
  only_when_human?: boolean;
}

export type AutomationTriggerConfig =
  | Record<string, never>
  | NoReplyTriggerConfig
  | KeywordMatchTriggerConfig
  | TagTriggerConfig
  | TimeBasedTriggerConfig
  | Record<string, unknown>;

export interface SendMessageStepConfig {
  text: string;
}

export interface SendTemplateStepConfig {
  template_name: string;
  language?: string;
  variables?: Record<string, string>;
}

export interface TagStepConfig {
  tag_id: string;
}

export interface AssignConversationStepConfig {
  mode: 'specific' | 'round_robin';
  agent_id?: string;
}

export interface UpdateContactFieldStepConfig {
  field: string;
  value: string;
}

export interface CreateDealStepConfig {
  pipeline_id: string;
  stage_id: string;
  title: string;
  value?: number;
}

export interface WaitStepConfig {
  amount: number;
  unit: 'minutes' | 'hours' | 'days';
}

export type ConditionSubject =
  | 'contact_field'
  | 'tag_presence'
  | 'message_content'
  | 'time_of_day';

export interface ConditionStepConfig {
  subject: ConditionSubject;
  /** e.g. field name, tag id, substring, or "HH:mm-HH:mm" depending on subject */
  operand?: string;
  /** For contact_field equals / message_content contains — comparison value */
  value?: string;
}

export interface SendWebhookStepConfig {
  url: string;
  headers?: Record<string, string>;
  body_template?: string;
}

/** ai_followup: the AI writes a short follow-up from the conversation. */
export interface AiFollowupStepConfig {
  /** Defaults to the conversation's agent, then the channel's agent. */
  agent_id?: string;
  /** Extra guidance for this follow-up (e.g. "mention the 10% discount"). */
  instructions?: string;
}

export type AutomationStepConfig =
  | SendMessageStepConfig
  | AiFollowupStepConfig
  | SendTemplateStepConfig
  | TagStepConfig
  | AssignConversationStepConfig
  | UpdateContactFieldStepConfig
  | CreateDealStepConfig
  | WaitStepConfig
  | ConditionStepConfig
  | SendWebhookStepConfig
  | Record<string, never>
  | Record<string, unknown>;

export interface Automation {
  id: string;
  workspace_id: string;
  /** Created by (nullable since workspaces). */
  user_id?: string | null;
  name: string;
  description?: string;
  trigger_type: AutomationTriggerType;
  trigger_config: AutomationTriggerConfig;
  is_active: boolean;
  execution_count: number;
  last_executed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationStep {
  id: string;
  workspace_id?: string;
  automation_id: string;
  parent_step_id?: string | null;
  branch?: 'yes' | 'no' | null;
  step_type: AutomationStepType;
  step_config: AutomationStepConfig;
  position: number;
  created_at: string;
}

export interface AutomationLogStepResult {
  step_id: string;
  step_type: AutomationStepType;
  status: 'success' | 'skipped' | 'failed';
  detail?: string;
}

export interface AutomationLog {
  id: string;
  automation_id: string;
  workspace_id: string;
  /** Created by (nullable since workspaces). */
  user_id?: string | null;
  contact_id: string | null;
  trigger_event: string;
  steps_executed: AutomationLogStepResult[];
  status: AutomationLogStatus;
  error_message?: string | null;
  created_at: string;
  contact?: Contact;
}

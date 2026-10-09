// Client-safe types for the "Bandeja Pro" inbox features (migration 032).

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export type Priority = (typeof PRIORITIES)[number]

export const EVENT_TYPES = [
  'assigned',
  'unassigned',
  'transferred',
  'resolved',
  'reopened',
  'priority',
  'tag_added',
  'tag_removed',
] as const
export type ConversationEventType = (typeof EVENT_TYPES)[number]

export interface ConversationEvent {
  id: string
  workspace_id?: string
  conversation_id: string
  type: ConversationEventType
  from_user: string | null
  to_user: string | null
  team_id: string | null
  note: string | null
  data: Record<string, unknown>
  created_at: string
}

export type AttachmentType = 'image' | 'video' | 'audio' | 'document'

export interface QuickReplyAttachment {
  /** Object path in the private `attachments` bucket. */
  path?: string
  /** Public http(s) URL (alternative to `path`). */
  url?: string
  type: AttachmentType
  name: string
}

export interface QuickReply {
  id: string
  workspace_id: string
  shortcut: string
  title: string
  body: string
  attachments: QuickReplyAttachment[]
  created_by: string | null
  is_shared: boolean
  created_at: string
  updated_at: string
}

export type NotificationType = 'mention' | 'assigned' | 'transferred' | 'system' | 'billing'

export interface AppNotification {
  id: string
  workspace_id: string
  user_id: string
  type: NotificationType
  title: string
  body: string | null
  link: string | null
  conversation_id: string | null
  actor_id: string | null
  read_at: string | null
  created_at: string
}

export interface Team {
  id: string
  workspace_id: string
  name: string
  description: string | null
  created_at: string
  /** user ids (filled by the API). */
  member_ids?: string[]
}

export type AutoAssignMode = 'off' | 'round_robin'

export interface InboxSettings {
  auto_assign: AutoAssignMode
  default_team_id: string | null
}

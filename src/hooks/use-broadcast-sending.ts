'use client';

import { useState } from 'react';
import { Contact, MessageTemplate } from '@/types';

export type CustomFieldOperator = 'is' | 'is_not' | 'contains';

export interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

export interface AudienceConfig {
  type: 'all' | 'tags' | 'custom_field' | 'csv';
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  /** Contacts carrying any of these tags are subtracted from the result. */
  excludeTagIds?: string[];
}

/**
 * Variable mapping — each template placeholder (by key, usually "1",
 * "2", …) is resolved at send time. `field` maps to a built-in contact
 * field (name/phone/email/company); `custom_field` maps to a
 * contact_custom_values.value row keyed by the custom_fields.id stored
 * in `value`.
 */
export type VariableMapping =
  | { type: 'static'; value: string }
  | { type: 'field'; value: string }
  | { type: 'custom_field'; value: string };

interface BroadcastPayload {
  name: string;
  template: MessageTemplate;
  audience: AudienceConfig;
  variables: Record<string, VariableMapping>;
}

interface UseBroadcastSendingReturn {
  createAndSendBroadcast: (payload: BroadcastPayload) => Promise<string>;
  isProcessing: boolean;
  progress: number;
}

/**
 * Meta rate-limit buffer. 10 per batch + 1 s pause matches the spec
 * and keeps us comfortably under Meta's per-phone-number messaging
 * rate so a large broadcast never trips the upstream limiter.
 */
const SEND_BATCH_SIZE = 10;
const SEND_BATCH_DELAY_MS = 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface BroadcastApiResult {
  phone: string;
  status: 'sent' | 'failed';
  whatsapp_message_id?: string;
  error?: string;
}

/** contactId → (customFieldId → value). */
type CustomValueIndex = Map<string, Map<string, string>>;

/**
 * Per-contact resolution of custom-field placeholders. Static and
 * built-in-field mappings resolve synchronously; custom fields read
 * from a pre-built index to avoid N+1 queries during the send loop.
 */
export function resolveVariables(
  variables: Record<string, VariableMapping>,
  contact: Contact,
  customValues?: Map<string, string>,
): string[] {
  // Keys are typically "1","2",... — numeric-aware sort keeps
  // {{1}} before {{10}}.
  const keys = Object.keys(variables).sort((a, b) => {
    const an = Number(a);
    const bn = Number(b);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return a.localeCompare(b);
  });

  return keys.map((key) => {
    const v = variables[key];
    if (v.type === 'static') return v.value;

    if (v.type === 'field') {
      const fieldMap: Record<string, string | undefined> = {
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        company: contact.company,
      };
      return fieldMap[v.value] ?? '';
    }

    // custom_field
    return customValues?.get(v.value) ?? '';
  });
}

function resolveMappingValue(
  mapping: VariableMapping | undefined,
  contact: Contact,
  customValues?: Map<string, string>,
): string {
  if (!mapping) return '';
  if (mapping.type === 'static') return mapping.value;
  if (mapping.type === 'field') {
    const fieldMap: Record<string, string | undefined> = {
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
      company: contact.company,
    };
    return fieldMap[mapping.value] ?? '';
  }
  if (mapping.type === 'custom_field') {
    return customValues?.get(mapping.value) ?? '';
  }
  return '';
}

export function resolveTemplateComponents(
  template: MessageTemplate,
  variables: Record<string, VariableMapping>,
  contact: Contact,
  customValues?: Map<string, string>,
): any[] {
  const components: any[] = [];

  // 1. Header component
  if (template.header_type === 'text' && template.header_content) {
    const matches = template.header_content.match(/\{\{(\d+)\}\}/g);
    if (matches && matches.length > 0) {
      const headerParams = matches.map((m) => {
        const key = `header_${m.replace(/^\{\{|\}\}$/g, '')}`;
        const mapping = variables[key];
        const val = resolveMappingValue(mapping, contact, customValues);
        return { type: 'text', text: val };
      });
      components.push({
        type: 'header',
        parameters: headerParams,
      });
    }
  }

  // Media header: the sample uploaded with the template is sent as the media.
  if (
    (template.header_type === 'image' || template.header_type === 'video' || template.header_type === 'document') &&
    template.header_media_url
  ) {
    const kind = template.header_type;
    components.push({ type: 'header', parameters: [{ type: kind, [kind]: { link: template.header_media_url } }] });
  }

  // 2. Body component
  const bodyMatches = template.body_text.match(/\{\{(\d+)\}\}/g);
  if (bodyMatches && bodyMatches.length > 0) {
    const uniqueMatches = [...new Set(bodyMatches)].sort((a, b) => {
      return Number(a.replace(/^\{\{|\}\}$/g, '')) - Number(b.replace(/^\{\{|\}\}$/g, ''));
    });
    const bodyParams = uniqueMatches.map((m) => {
      const numStr = m.replace(/^\{\{|\}\}$/g, '');
      const key = `body_${numStr}`;
      const mapping = variables[key] ?? variables[numStr];
      const val = resolveMappingValue(mapping, contact, customValues);
      return { type: 'text', text: val };
    });
    components.push({
      type: 'body',
      parameters: bodyParams,
    });
  }

  // 3. Button components
  if (template.buttons && Array.isArray(template.buttons)) {
    template.buttons.forEach((btn: any, btnIndex: number) => {
      // Synced templates store Meta's shape (type 'URL', url); the editor
      // stores type 'url' with the address in `value`.
      const url: string | undefined = btn.url ?? btn.value;
      if ((btn.type === 'URL' || btn.type === 'url') && url) {
        const btnMatches = url.match(/\{\{(\d+)\}\}/g);
        if (btnMatches && btnMatches.length > 0) {
          const btnParams = btnMatches.map((m: string) => {
            const key = `button_${btnIndex}_${m.replace(/^\{\{|\}\}$/g, '')}`;
            const mapping = variables[key];
            const val = resolveMappingValue(mapping, contact, customValues);
            return { type: 'text', text: val };
          });
          components.push({
            type: 'button',
            sub_type: 'url',
            index: String(btnIndex),
            parameters: btnParams,
          });
        }
      }
    });
  }

  return components;
}

interface PreparedRecipient {
  id: string;
  contact: Contact | null;
}

interface RecipientResult {
  id: string;
  status: 'sent' | 'failed';
  whatsapp_message_id?: string | null;
  error_message?: string | null;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

/** Stores send results (and optionally the final status); best effort like the old per-row updates. */
async function reportProgress(broadcastId: string, recipients: RecipientResult[], status?: 'sent' | 'failed') {
  try {
    await postJson(`/api/broadcasts/${broadcastId}/progress`, { recipients, status });
  } catch (err) {
    console.error('Failed to record broadcast progress:', err instanceof Error ? err.message : err);
  }
}

export function useBroadcastSending(): UseBroadcastSendingReturn {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  async function createAndSendBroadcast(payload: BroadcastPayload): Promise<string> {
    setIsProcessing(true);
    setProgress(0);

    try {
      // ── Steps 1–4 (server): resolve the audience, create the broadcast
      // and its pending recipients, return them with every custom value
      // the templates may need (CSV phones not in contacts are created).
      setProgress(5);
      const prepared = await postJson<{
        broadcast: { id: string };
        recipients: PreparedRecipient[];
        custom_values: Record<string, Record<string, string>>;
      }>('/api/broadcasts/prepare', {
        name: payload.name,
        template_name: payload.template.name,
        template_language: payload.template.language ?? 'en_US',
        variables: payload.variables,
        audience: {
          type: payload.audience.type,
          tagIds: payload.audience.tagIds,
          customField: payload.audience.customField,
          csvContacts: payload.audience.csvContacts,
          excludeTagIds: payload.audience.excludeTagIds,
        },
      });
      const broadcast = prepared.broadcast;
      const recipients = prepared.recipients ?? [];
      setProgress(30);

      const customValueIndex: CustomValueIndex = new Map(
        Object.entries(prepared.custom_values ?? {}).map(([contactId, values]) => [contactId, new Map(Object.entries(values))]),
      );

      let failedCount = 0;
      const totalRecipients = recipients.length;

      for (let i = 0; i < recipients.length; i += SEND_BATCH_SIZE) {
        const batch = recipients.slice(i, i + SEND_BATCH_SIZE);
        const results: RecipientResult[] = [];

        const apiRecipients = batch
          .filter((r) => r.contact?.phone)
          .map((r) => ({
            phone: r.contact!.phone as string,
            components: r.contact
              ? resolveTemplateComponents(
                  payload.template,
                  payload.variables,
                  r.contact,
                  customValueIndex.get(r.contact.id),
                )
              : [],
          }));

        if (apiRecipients.length === 0) continue;

        try {
          const res = await fetch('/api/whatsapp/broadcast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recipients: apiRecipients,
              template_name: payload.template.name,
              template_language: payload.template.language ?? 'en_US',
            }),
          });

          const data = await res.json();

          if (!res.ok) {
            throw new Error(data.error || 'Broadcast API request failed');
          }

          const resultsByPhone = new Map<string, BroadcastApiResult>();
          for (const r of (data.results ?? []) as BroadcastApiResult[]) {
            resultsByPhone.set(r.phone, r);
          }

          for (const recipient of batch) {
            const phone = recipient.contact?.phone;
            const result = phone ? resultsByPhone.get(phone) : undefined;

            if (!result) {
              failedCount++;
              results.push({ id: recipient.id, status: 'failed', error_message: 'No phone number on contact' });
            } else if (result.status === 'sent') {
              results.push({ id: recipient.id, status: 'sent', whatsapp_message_id: result.whatsapp_message_id ?? null });
            } else {
              failedCount++;
              results.push({ id: recipient.id, status: 'failed', error_message: result.error ?? 'Unknown error' });
            }
          }
        } catch (err) {
          for (const recipient of batch) {
            failedCount++;
            results.push({
              id: recipient.id,
              status: 'failed',
              error_message: err instanceof Error ? err.message : 'Unknown error',
            });
          }
        }
        await reportProgress(broadcast.id, results);

        const progressPct =
          30 + Math.round(((i + batch.length) / totalRecipients) * 60);
        setProgress(progressPct);

        if (i + SEND_BATCH_SIZE < recipients.length) {
          await sleep(SEND_BATCH_DELAY_MS);
        }
      }

      // ── Step 5: Finalize status ───────────────────────────────────
      // Aggregate counts are maintained by the DB trigger (migration
      // 003); we only flip the final status here.
      setProgress(95);
      const finalStatus = failedCount === totalRecipients ? 'failed' : 'sent';
      await reportProgress(broadcast.id, [], finalStatus);

      setProgress(100);
      return broadcast.id;
    } finally {
      setIsProcessing(false);
    }
  }

  return { createAndSendBroadcast, isProcessing, progress };
}

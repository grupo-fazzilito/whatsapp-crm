"use client"

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { AlertTriangle, Ban, Hourglass } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { createClient } from "@/lib/supabase/client"
import { useT } from "@/i18n/client"
import type { Translator } from "@/i18n/translate"
import { CHANNEL_TYPE_LABELS } from "@/lib/channels/capabilities"
import type { ChannelType } from "@/lib/channels/types"
import {
  DEFAULT_NO_REPLY_CONFIG,
  LAST_CALL_PRESET,
  normalizeNoReplyConfig,
} from "@/lib/automations/followup-rules"
import {
  validateChannelRules,
  validateStepsForActivation,
  validateTriggerForActivation,
  type ValidationIssue,
} from "@/lib/automations/validate"
import type { DelayUnit, NoReplyTriggerConfig } from "@/types"
import { cn } from "@/lib/utils"

// ------------------------------------------------------------
// "Seguimientos" pieces of the automation builder: the no_reply trigger
// config, the ai_followup step editor and the messaging-window review.
// ------------------------------------------------------------

export interface BuilderChannel {
  id: string
  name: string
  type: ChannelType
  ai_agent_id: string | null
}

export interface BuilderAgent {
  id: string
  name: string
  enabled: boolean
}

interface BuilderData {
  channels: BuilderChannel[]
  agents: BuilderAgent[]
  loaded: boolean
}

const BuilderDataContext = createContext<BuilderData>({ channels: [], agents: [], loaded: false })

/** Loads the workspace's channels and AI agents once for the whole builder. */
export function BuilderDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<BuilderData>({ channels: [], agents: [], loaded: false })
  useEffect(() => {
    let alive = true
    const db = createClient()
    Promise.all([
      db.from("channels").select("id, name, type, ai_agent_id").order("created_at", { ascending: true }),
      db.from("ai_agents").select("id, name, enabled").order("created_at", { ascending: true }),
    ]).then(([ch, ag]) => {
      if (!alive) return
      setData({
        channels: (ch.data ?? []) as BuilderChannel[],
        agents: (ag.data ?? []) as BuilderAgent[],
        loaded: true,
      })
    })
    return () => {
      alive = false
    }
  }, [])
  return <BuilderDataContext.Provider value={data}>{children}</BuilderDataContext.Provider>
}

export function useBuilderData(): BuilderData {
  return useContext(BuilderDataContext)
}

/** Text for a validation issue: translated when it has a code. */
export function issueText(issue: ValidationIssue, t: Translator): string {
  if (!issue.code) return issue.message
  const key = `followups.issues.${issue.code}`
  const out = t(key, issue.params)
  return out === key ? issue.message : out
}

const selectCls =
  "w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white focus:border-primary focus:outline-none"

// ------------------------------------------------------------
// Trigger: "El cliente no respondió"
// ------------------------------------------------------------

export function noReplyDefaults(config: Record<string, unknown>): Record<string, unknown> | null {
  return config && typeof config === "object" && "after" in config
    ? null
    : (DEFAULT_NO_REPLY_CONFIG as unknown as Record<string, unknown>)
}

export function noReplySummary(config: Record<string, unknown>, t: Translator): string {
  const cfg = normalizeNoReplyConfig(config)
  return t("followups.trigger.summary", {
    amount: cfg.after.amount,
    unit: t(`followups.trigger.units.${cfg.after.unit}`),
  })
}

export function NoReplyConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
}) {
  const t = useT()
  const { channels, loaded } = useBuilderData()
  const cfg = normalizeNoReplyConfig(config)
  const emit = (patch: Partial<NoReplyTriggerConfig>) =>
    onChange({ ...config, ...cfg, ...patch } as unknown as Record<string, unknown>)
  const isLastCall = cfg.after.amount === LAST_CALL_PRESET.amount && cfg.after.unit === LAST_CALL_PRESET.unit
  const selected = new Set(cfg.channel_ids ?? [])
  const handler = cfg.only_when_ai ? "ai" : cfg.only_when_human ? "human" : "all"

  function toggleChannel(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    emit({ channel_ids: [...next] })
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">{t("followups.trigger.after")}</label>
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="number"
            min={1}
            aria-label={t("followups.trigger.amount")}
            value={cfg.after.amount || ""}
            onChange={(e) => emit({ after: { ...cfg.after, amount: Math.max(0, Number(e.target.value) || 0) } })}
            className="bg-slate-800 text-white"
          />
          <select
            aria-label={t("followups.trigger.unit")}
            value={cfg.after.unit}
            onChange={(e) => emit({ after: { ...cfg.after, unit: e.target.value as DelayUnit } })}
            className={selectCls}
          >
            {(["minutes", "hours", "days"] as const).map((u) => (
              <option key={u} value={u}>
                {t(`followups.trigger.units.${u}`)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => emit({ after: { ...LAST_CALL_PRESET } })}
          aria-pressed={isLastCall}
          className={cn(
            "mt-2 flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors",
            isLastCall
              ? "border-violet-500/60 bg-violet-500/10 text-violet-200"
              : "border-slate-700 text-slate-300 hover:border-violet-500/50 hover:text-white",
          )}
        >
          <Hourglass className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
          {t("followups.trigger.lastCall")}
        </button>
        <p className="mt-1 text-[11px] text-slate-500">{t("followups.trigger.lastCallHint")}</p>
      </div>

      <fieldset>
        <legend className="mb-1 block text-xs font-medium text-slate-400">{t("followups.trigger.channels")}</legend>
        {loaded && channels.length === 0 ? (
          <p className="text-[11px] text-slate-500">{t("followups.trigger.noChannels")}</p>
        ) : (
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={selected.size === 0}
                onChange={() => emit({ channel_ids: [] })}
                className="h-4 w-4 accent-primary"
              />
              {t("followups.trigger.allChannels")}
            </label>
            {channels.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => toggleChannel(c.id)}
                  className="h-4 w-4 accent-primary"
                />
                <span className="truncate">{c.name}</span>
                <span className="text-[11px] text-slate-500">{CHANNEL_TYPE_LABELS[c.type] ?? c.type}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400" htmlFor="no-reply-handler">
          {t("followups.trigger.handler")}
        </label>
        <select
          id="no-reply-handler"
          value={handler}
          onChange={(e) =>
            emit({ only_when_ai: e.target.value === "ai", only_when_human: e.target.value === "human" })
          }
          className={selectCls}
        >
          <option value="all">{t("followups.trigger.handlerAll")}</option>
          <option value="ai">{t("followups.trigger.handlerAi")}</option>
          <option value="human">{t("followups.trigger.handlerHuman")}</option>
        </select>
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// Step: "Seguimiento con IA"
// ------------------------------------------------------------

export function AiFollowupEditor({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (patch: Record<string, unknown>) => void
}) {
  const t = useT()
  const { agents } = useBuilderData()
  const agentId = (config.agent_id as string) ?? ""
  return (
    <div className="space-y-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400" htmlFor="ai-followup-agent">
          {t("followups.step.agent")}
        </label>
        <select
          id="ai-followup-agent"
          value={agentId}
          onChange={(e) => onChange({ agent_id: e.target.value || undefined })}
          className={selectCls}
        >
          <option value="">{t("followups.step.agentDefault")}</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.enabled ? "" : ` (${t("followups.step.agentDisabled")})`}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400" htmlFor="ai-followup-instructions">
          {t("followups.step.instructions")}
        </label>
        <Textarea
          id="ai-followup-instructions"
          value={(config.instructions as string) ?? ""}
          maxLength={1000}
          onChange={(e) => onChange({ instructions: e.target.value })}
          placeholder={t("followups.step.instructionsPlaceholder")}
          className="min-h-20 bg-slate-800 text-white"
        />
      </div>
      <p className="text-[11px] text-slate-500">{t("followups.step.help")}</p>
    </div>
  )
}

// ------------------------------------------------------------
// Messaging-window review (same rules the API enforces on activation)
// ------------------------------------------------------------

interface ReviewStep {
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes?: ReviewStep[]; no?: ReviewStep[] }
}

export function FollowupReview({
  triggerType,
  triggerConfig,
  steps,
}: {
  triggerType: string
  triggerConfig: Record<string, unknown>
  steps: ReviewStep[]
}) {
  const t = useT()
  const { channels } = useBuilderData()
  const issues = useMemo(() => {
    const all = [
      ...validateTriggerForActivation(triggerType, triggerConfig),
      ...validateStepsForActivation(steps),
      ...validateChannelRules({ triggerType, triggerConfig, steps, channels }),
    ]
    // Only the follow-up / window rules here; the rest surface on save.
    return all.filter((i) => i.code)
  }, [triggerType, triggerConfig, steps, channels])

  if (issues.length === 0) return null
  return (
    <div className="z-10 mt-3 w-full max-w-[320px] rounded-lg border border-amber-500/30 bg-slate-900/95 p-3 sm:w-80" role="status">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-amber-300">
        {t("followups.panel.title")}
      </div>
      <ul className="space-y-2">
        {issues.map((i, idx) => {
          const isError = i.severity !== "warning"
          const Icon = isError ? Ban : AlertTriangle
          return (
            <li key={`${i.path}-${idx}`} className="flex gap-2 text-xs">
              <Icon className={cn("mt-0.5 h-3.5 w-3.5 flex-shrink-0", isError ? "text-rose-400" : "text-amber-400")} aria-hidden />
              <div>
                <span className={cn("font-medium", isError ? "text-rose-300" : "text-amber-300")}>
                  {isError ? t("followups.panel.error") : t("followups.panel.warning")}:
                </span>{" "}
                <span className="text-slate-300">{issueText(i, t)}</span>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

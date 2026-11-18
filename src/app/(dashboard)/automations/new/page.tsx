"use client"

import { useMemo } from "react"
import { useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"

import {
  AutomationBuilder,
  type BuilderInitial,
  type BuilderStep,
} from "@/components/automations/automation-builder"
import {
  AUTOMATION_TEMPLATES,
  localizedTemplate,
  templateLabels,
  type TemplateSlug,
} from "@/lib/automations/templates"
import { useI18n } from "@/i18n/client"
import { createTranslator } from "@/i18n/translate"
import { isLocale } from "@/i18n/config"
import { useWorkspace } from "@/hooks/use-workspace"
import type { AutomationStepType, AutomationTriggerType } from "@/types"

export default function NewAutomationPage() {
  const params = useSearchParams()
  const template = params.get("template") as TemplateSlug | null
  const { t, locale } = useI18n()
  const { workspace, loading } = useWorkspace()
  const hasTemplate = !!template && !!AUTOMATION_TEMPLATES[template]
  // Customer-facing template text follows the workspace language; the
  // UI language is the fallback while/if the workspace has none.
  const workspaceLocale = workspace?.locale
  const messageLocale = isLocale(workspaceLocale) ? workspaceLocale : locale

  const initial: BuilderInitial = useMemo(() => {
    if (template && AUTOMATION_TEMPLATES[template]) {
      const tpl = localizedTemplate(template, createTranslator(messageLocale))
      const labels = templateLabels(template, t)
      const steps = expandFromSeeds(
        tpl.steps.map((seed, idx) => ({
          index: idx,
          step_type: seed.step_type,
          step_config: seed.step_config as Record<string, unknown>,
          branch: seed.branch ?? null,
          parent_index: seed.parent_index ?? null,
        })),
      )
      return {
        name: labels.name,
        description: labels.description,
        trigger_type: tpl.trigger_type,
        trigger_config: tpl.trigger_config as Record<string, unknown>,
        is_active: false,
        steps,
      }
    }
    return {
      name: "",
      description: "",
      trigger_type: "new_message_received" as AutomationTriggerType,
      trigger_config: {},
      is_active: false,
      steps: [],
    }
  }, [template, t, messageLocale])

  // The builder copies `initial` once, so wait for the workspace locale
  // before seeding a template's messages.
  if (hasTemplate && loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  return <AutomationBuilder initial={initial} />
}

interface SeedRow {
  index: number
  step_type: AutomationStepType
  step_config: Record<string, unknown>
  branch: "yes" | "no" | null
  parent_index: number | null
}

function uid(): string {
  return (
    "c_" +
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36))
  )
}

/** Template seeds are flat with parent_index references. Expand into the
 *  builder's nested tree, preserving order within each scope. */
function expandFromSeeds(rows: SeedRow[]): BuilderStep[] {
  const nodes: BuilderStep[] = rows.map((r) => ({
    cid: uid(),
    step_type: r.step_type,
    step_config: r.step_config,
    branches:
      r.step_type === "condition" ? { yes: [], no: [] } : undefined,
  }))
  const roots: BuilderStep[] = []
  rows.forEach((r, i) => {
    if (r.parent_index == null) {
      roots.push(nodes[i])
      return
    }
    const parent = nodes[r.parent_index]
    if (!parent.branches) parent.branches = { yes: [], no: [] }
    parent.branches[r.branch ?? "yes"].push(nodes[i])
  })
  return roots
}

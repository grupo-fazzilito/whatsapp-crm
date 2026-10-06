import { PRESETS } from './presets'
import type { IndustryLabels, IndustryPreset, Locale, ModuleKey } from './types'
import type { WorkspaceSettings } from '@/lib/workspace/types'

export * from './types'
export { PRESETS }

export const INDUSTRY_IDS: string[] = PRESETS.map((p) => p.id)

export function getPreset(id: string | null | undefined): IndustryPreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS.find((p) => p.id === 'generic')!
}

/**
 * Effective configuration for a workspace: industry preset with the
 * workspace's own overrides (labels and module switches) on top.
 */
export function resolveIndustry(industry: string, settings?: WorkspaceSettings | null) {
  const preset = getPreset(industry)
  const modules = { ...preset.modules }
  for (const [k, v] of Object.entries(settings?.modules ?? {})) {
    if (k in modules && typeof v === 'boolean') modules[k as ModuleKey] = v
  }
  return { preset, modules }
}

/** Label for `key` in `locale`, honoring workspace overrides. */
export function industryLabel(
  industry: string,
  key: keyof IndustryLabels,
  locale: Locale,
  settings?: WorkspaceSettings | null,
): string {
  const override = settings?.labels?.[locale]?.[key]
  if (typeof override === 'string' && override.trim()) return override
  return getPreset(industry).labels[key][locale]
}

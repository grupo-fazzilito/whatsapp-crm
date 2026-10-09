export const AGENT_TONES = ['friendly', 'professional', 'formal', 'playful', 'empathetic', 'concise'] as const;
export type AgentTone = (typeof AGENT_TONES)[number];

export const AGENT_SKILLS = ['router', 'faq', 'bookings', 'catalog', 'orders', 'handover'] as const;
export type AgentSkill = (typeof AGENT_SKILLS)[number];

export type AgentLanguage = 'auto' | 'es' | 'en';

export interface AiAgent {
  id: string;
  workspace_id: string;
  name: string;
  /** What this agent handles (used by routers and transfers). */
  description: string | null;
  avatar_url: string | null;
  persona: string | null;
  tone: string;
  instructions: string | null;
  language: AgentLanguage;
  skills: string[];
  greeting_message: string | null;
  after_hours_message: string | null;
  escalation_keywords: string[];
  business_hours_only: boolean;
  model: string | null;
  enabled: boolean;
  /** Agents it may hand the conversation to (routers: empty = all non-routers). */
  transfer_agent_ids: string[];
  /** Business knowledge written by the owner (≤ 5,000 chars). */
  training_context: string | null;
  created_at: string;
  updated_at: string;
}

export type AgentDraft = Omit<AiAgent, 'id' | 'workspace_id' | 'avatar_url' | 'created_at' | 'updated_at' | 'training_context'>;

/** Model override per agent (null = automatic provider order). The prefix picks the provider in src/lib/ai/llm.ts. */
export const AGENT_MODELS = [
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'deepseek-flash', label: 'DeepSeek Flash' },
  { value: 'gpt-4o-mini', label: 'GPT-4o mini' },
] as const;

export const EMPTY_AGENT: AgentDraft = {
  name: '',
  description: '',
  persona: '',
  tone: 'friendly',
  instructions: '',
  language: 'auto',
  skills: ['faq', 'handover'],
  greeting_message: '',
  after_hours_message: '',
  escalation_keywords: ['humano', 'agente', 'asesor', 'human', 'agent'],
  business_hours_only: false,
  enabled: true,
  transfer_agent_ids: [],
  model: null,
};

/** Agents this one can hand conversations to (mirrors transferTargets in src/lib/ai/engine.ts). */
export function transferTargetsOf(agent: Pick<AiAgent, 'id' | 'skills' | 'transfer_agent_ids'>, all: AiAgent[]): AiAgent[] {
  const others = all.filter((a) => a.id !== agent.id && a.enabled);
  if (agent.transfer_agent_ids?.length) return others.filter((a) => agent.transfer_agent_ids.includes(a.id));
  return agent.skills.includes('router') ? others.filter((a) => !a.skills.includes('router')) : [];
}

export interface AgentChannelRef {
  id: string;
  name: string;
  type: string;
  ai_agent_id: string | null;
}

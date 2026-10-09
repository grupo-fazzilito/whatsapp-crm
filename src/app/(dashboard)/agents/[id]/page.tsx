import { AgentWorkspace } from '@/components/agents/agent-workspace';

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AgentWorkspace agentId={id} />;
}

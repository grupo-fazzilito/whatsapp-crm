import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  runAgent: vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true),
  loadChannel: vi.fn(async (ws: string, id: string) => ({ id, type: "whatsapp", workspace_id: ws, settings: {} })),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/engine", () => ({ runAgent: h.runAgent }));
vi.mock("@/lib/channels/store", () => ({ loadChannel: h.loadChannel }));
vi.mock("./meta-send", () => ({
  engineSendText: vi.fn(async () => ({ whatsapp_message_id: "wamid.x" })),
  engineSendInteractiveButtons: vi.fn(async () => ({ whatsapp_message_id: "wamid.b" })),
  engineSendInteractiveList: vi.fn(async () => ({ whatsapp_message_id: "wamid.l" })),
}));

import { pgTest } from "@/lib/test-utils/pg";
import { dispatchInboundToFlows, inboundTextOf, isTerminal } from "./engine";

// The DB part runs on a real Postgres (TEST_DATABASE_URL); skipped without it.
const pg = await pgTest();

describe("handoff_ai_agent node", () => {
  it("is terminal and reads the inbound text", () => {
    expect(isTerminal("handoff_ai_agent")).toBe(true);
    expect(inboundTextOf({ kind: "text", text: "hola", meta_message_id: "m" })).toBe("hola");
    expect(inboundTextOf({ kind: "interactive_reply", reply_id: "x", reply_title: "Soporte", meta_message_id: "m" })).toBe("Soporte");
    expect(inboundTextOf(null)).toBe("");
  });
});

describe.skipIf(!pg)("handoff_ai_agent node (Postgres)", () => {
  let ws: Awaited<ReturnType<NonNullable<typeof pg>["workspace"]>>;
  let channelId: string;
  let contactId: string;
  let conversationId: string;
  let flowId: string;

  beforeAll(async () => {
    ws = await pg!.workspace();
    const W = ws.workspaceId;
    channelId = (await ws.db.channels.create({ data: { workspace_id: W, type: "whatsapp", name: "WA", external_id: `ext-${W}` } })).id;
    contactId = (await ws.db.contacts.create({ data: { workspace_id: W, name: "Ana" } })).id;
  });

  afterAll(async () => {
    await pg!.cleanup(ws);
  });

  beforeEach(async () => {
    h.runAgent.mockClear();
    h.loadChannel.mockClear();
    const W = ws.workspaceId;
    await ws.db.flows.deleteMany({ where: {} });
    await ws.db.conversations.deleteMany({ where: {} });
    await ws.db.ai_agents.deleteMany({ where: {} });
    conversationId = (
      await ws.db.conversations.create({
        data: { workspace_id: W, contact_id: contactId, channel_id: channelId, ai_agent_id: null, ai_paused_until: "2099-01-01T00:00:00Z" },
      })
    ).id;
  });

  async function seed(agentEnabled = true) {
    const W = ws.workspaceId;
    const agent = await ws.db.ai_agents.create({ data: { workspace_id: W, name: "Max", enabled: agentEnabled, skills: ["faq"] } });
    const flow = await ws.db.flows.create({
      data: {
        workspace_id: W,
        name: "Ventas",
        status: "active",
        trigger_type: "keyword",
        trigger_config: { keywords: ["precio"] },
        entry_node_id: "start",
        fallback_policy: {},
      },
    });
    flowId = flow.id;
    await ws.db.flow_nodes.createMany({
      data: [
        { workspace_id: W, flow_id: flow.id, node_key: "start", node_type: "start", config: { next_node_key: "to_ai" } },
        { workspace_id: W, flow_id: flow.id, node_key: "to_ai", node_type: "handoff_ai_agent", config: { agent_id: agent.id } },
      ],
    });
    return agent.id;
  }

  const input = () => ({
    workspaceId: ws.workspaceId,
    contactId,
    conversationId,
    message: { kind: "text" as const, text: "¿Qué precio tiene?", meta_message_id: "wamid.in" },
    isFirstInboundMessage: false,
  });

  it("pins the agent, completes the run and lets the agent answer the same message", async () => {
    const agentId = await seed();
    const res = await dispatchInboundToFlows(input());
    expect(res).toMatchObject({ consumed: true, outcome: "completed" });

    const conv = await ws.db.conversations.findFirstOrThrow({ where: { id: conversationId } });
    expect(conv.ai_agent_id).toBe(agentId);
    expect(conv.ai_paused_until).toBeNull();

    const runs = await ws.db.flow_runs.findMany({ where: { flow_id: flowId } });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("completed");
    expect(runs[0].end_reason).toBe("handoff_ai_agent");

    const flow = await ws.db.flows.findFirstOrThrow({ where: { id: flowId } });
    expect(flow.execution_count).toBe(1);
    const events = await ws.db.flow_run_events.findMany({ where: { flow_run_id: runs[0].id } });
    expect(events.map((e) => e.event_type)).toEqual(expect.arrayContaining(["started", "handoff", "completed"]));

    expect(h.loadChannel).toHaveBeenCalledWith(ws.workspaceId, channelId);
    expect(h.runAgent).toHaveBeenCalledTimes(1);
    expect(h.runAgent.mock.calls[0][0]).toMatchObject({
      workspaceId: ws.workspaceId,
      conversationId,
      contactId,
      messageText: "¿Qué precio tiene?",
      contextMessageId: "wamid.in",
      agent: { id: agentId },
    });
  });

  it("fails the run without touching the conversation when the agent is disabled", async () => {
    await seed(false);
    const res = await dispatchInboundToFlows(input());
    expect(res.consumed).toBe(true);
    const runs = await ws.db.flow_runs.findMany({ where: { flow_id: flowId } });
    expect(runs[0].status).toBe("failed");
    const conv = await ws.db.conversations.findFirstOrThrow({ where: { id: conversationId } });
    expect(conv.ai_agent_id).toBeNull();
    expect(h.runAgent).not.toHaveBeenCalled();
  });
});

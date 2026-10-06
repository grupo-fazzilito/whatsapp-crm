import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/test-utils/fake-supabase";

const h = vi.hoisted(() => ({
  db: null as unknown as import("@/lib/test-utils/fake-supabase").FakeDb,
  runAgent: vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true),
  loadChannel: vi.fn(async (_ws: string, id: string) => ({ id, type: "whatsapp", workspace_id: "ws1", settings: {} })),
}));

vi.mock("./admin-client", () => ({ supabaseAdmin: () => h.db }));
vi.mock("@/lib/ai/engine", () => ({ runAgent: h.runAgent }));
vi.mock("@/lib/channels/store", () => ({ loadChannel: h.loadChannel }));
vi.mock("./meta-send", () => ({
  engineSendText: vi.fn(async () => ({ whatsapp_message_id: "wamid.x" })),
  engineSendInteractiveButtons: vi.fn(async () => ({ whatsapp_message_id: "wamid.b" })),
  engineSendInteractiveList: vi.fn(async () => ({ whatsapp_message_id: "wamid.l" })),
}));

import { dispatchInboundToFlows, inboundTextOf, isTerminal } from "./engine";

const WS = "ws1";

function seed(agentEnabled = true) {
  h.db = new FakeDb({
    flows: [
      {
        id: "f1",
        workspace_id: WS,
        user_id: null,
        name: "Ventas",
        status: "active",
        trigger_type: "keyword",
        trigger_config: { keywords: ["precio"] },
        entry_node_id: "start",
        fallback_policy: {},
        created_at: "2026-01-01",
      },
    ],
    flow_nodes: [
      { id: "n1", workspace_id: WS, flow_id: "f1", node_key: "start", node_type: "start", config: { next_node_key: "to_ai" } },
      { id: "n2", workspace_id: WS, flow_id: "f1", node_key: "to_ai", node_type: "handoff_ai_agent", config: { agent_id: "ag1" } },
    ],
    ai_agents: [{ id: "ag1", workspace_id: WS, name: "Max", enabled: agentEnabled, skills: ["faq"] }],
    conversations: [{ id: "c1", workspace_id: WS, channel_id: "ch1", ai_agent_id: null, ai_paused_until: "2099-01-01T00:00:00Z" }],
    flow_runs: [],
    flow_run_events: [],
  });
}

const input = {
  workspaceId: WS,
  contactId: "ct1",
  conversationId: "c1",
  message: { kind: "text" as const, text: "¿Qué precio tiene?", meta_message_id: "wamid.in" },
  isFirstInboundMessage: false,
};

describe("handoff_ai_agent node", () => {
  beforeEach(() => {
    h.runAgent.mockClear();
    h.loadChannel.mockClear();
  });

  it("is terminal and reads the inbound text", () => {
    expect(isTerminal("handoff_ai_agent")).toBe(true);
    expect(inboundTextOf({ kind: "text", text: "hola", meta_message_id: "m" })).toBe("hola");
    expect(inboundTextOf({ kind: "interactive_reply", reply_id: "x", reply_title: "Soporte", meta_message_id: "m" })).toBe("Soporte");
    expect(inboundTextOf(null)).toBe("");
  });

  it("pins the agent, completes the run and lets the agent answer the same message", async () => {
    seed();
    const res = await dispatchInboundToFlows(input);
    expect(res).toMatchObject({ consumed: true, outcome: "completed" });

    const conv = h.db.rows("conversations")[0];
    expect(conv.ai_agent_id).toBe("ag1");
    expect(conv.ai_paused_until).toBeNull();

    const run = h.db.rows("flow_runs")[0];
    expect(run.status).toBe("completed");
    expect(run.end_reason).toBe("handoff_ai_agent");

    expect(h.loadChannel).toHaveBeenCalledWith(WS, "ch1");
    expect(h.runAgent).toHaveBeenCalledTimes(1);
    expect(h.runAgent.mock.calls[0][0]).toMatchObject({
      workspaceId: WS,
      conversationId: "c1",
      contactId: "ct1",
      messageText: "¿Qué precio tiene?",
      contextMessageId: "wamid.in",
      agent: { id: "ag1" },
    });
  });

  it("fails the run without touching the conversation when the agent is disabled", async () => {
    seed(false);
    const res = await dispatchInboundToFlows(input);
    expect(res.consumed).toBe(true);
    expect(h.db.rows("flow_runs")[0].status).toBe("failed");
    expect(h.db.rows("conversations")[0].ai_agent_id).toBeNull();
    expect(h.runAgent).not.toHaveBeenCalled();
  });
});

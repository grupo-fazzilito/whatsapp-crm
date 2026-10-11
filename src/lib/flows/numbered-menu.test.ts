import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sendText: vi.fn(async (_args: { text: string }) => ({ whatsapp_message_id: "wamid.t" })),
  sendButtons: vi.fn(async () => ({ whatsapp_message_id: "wamid.b" })),
}));

vi.mock("server-only", () => ({}));
vi.mock("./meta-send", () => ({
  engineSendText: h.sendText,
  engineSendInteractiveButtons: h.sendButtons,
  engineSendInteractiveList: vi.fn(async () => ({ whatsapp_message_id: "wamid.l" })),
}));

import { pgTest } from "@/lib/test-utils/pg";
import { dispatchInboundToFlows } from "./engine";

// Runs on a real Postgres (TEST_DATABASE_URL); skipped without it.
const pg = await pgTest();

describe.skipIf(!pg)("numbered menus (Postgres)", () => {
  let ws: Awaited<ReturnType<NonNullable<typeof pg>["workspace"]>>;
  let contactId: string;
  let conversationId: string;
  let n = 0;

  beforeAll(async () => {
    ws = await pg!.workspace();
    const W = ws.workspaceId;
    const channelId = (await ws.db.channels.create({ data: { workspace_id: W, type: "whatsapp", name: "WA", external_id: `ext-${W}` } })).id;
    contactId = (await ws.db.contacts.create({ data: { workspace_id: W, name: "Ana" } })).id;
    conversationId = (await ws.db.conversations.create({ data: { workspace_id: W, contact_id: contactId, channel_id: channelId } })).id;
  });

  afterAll(async () => {
    await pg!.cleanup(ws);
  });

  beforeEach(async () => {
    h.sendText.mockClear();
    h.sendButtons.mockClear();
    await ws.db.flows.deleteMany({ where: {} });
    const W = ws.workspaceId;
    const flow = await ws.db.flows.create({
      data: {
        workspace_id: W,
        name: "Menú",
        status: "active",
        trigger_type: "keyword",
        trigger_config: { keywords: ["menu"], match_type: "exact" },
        entry_node_id: "start",
        fallback_policy: { on_unknown_reply: "reprompt", max_reprompts: 1, on_exhaust: "handoff" },
      },
    });
    const option = (id: string, title: string, next: string) => ({ reply_id: id, title, next_node_key: next });
    await ws.db.flow_nodes.createMany({
      data: [
        { workspace_id: W, flow_id: flow.id, node_key: "start", node_type: "start", config: { next_node_key: "menu" } },
        {
          workspace_id: W,
          flow_id: flow.id,
          node_key: "menu",
          node_type: "send_buttons",
          config: {
            display: "numbered",
            text: "¿En qué te puedo ayudar?",
            footer_text: "Marca el número de la opción.",
            buttons: [option("v", "Ventas", "ventas"), option("s", "Soporte", "soporte"), option("p", "Pagos", "end"), option("h", "Horarios", "end")],
          },
        },
        { workspace_id: W, flow_id: flow.id, node_key: "ventas", node_type: "send_message", config: { text: "Te paso con ventas.", next_node_key: "end" } },
        { workspace_id: W, flow_id: flow.id, node_key: "soporte", node_type: "send_message", config: { text: "Cuéntame tu problema.", next_node_key: "end" } },
        { workspace_id: W, flow_id: flow.id, node_key: "end", node_type: "end", config: {} },
      ],
    });
  });

  const say = (text: string) =>
    dispatchInboundToFlows({
      workspaceId: ws.workspaceId,
      contactId,
      conversationId,
      message: { kind: "text", text, meta_message_id: `wamid.in.${++n}` },
      isFirstInboundMessage: false,
    });

  it("sends the menu as numbered text and advances on a typed number", async () => {
    expect(await say("menu")).toMatchObject({ consumed: true, outcome: "started" });
    expect(h.sendButtons).not.toHaveBeenCalled();
    expect(h.sendText.mock.calls[0][0].text).toBe(
      "¿En qué te puedo ayudar?\n\n1. Ventas\n2. Soporte\n3. Pagos\n4. Horarios\n\nMarca el número de la opción.",
    );

    expect(await say("dos")).toMatchObject({ consumed: true });
    expect(h.sendText.mock.calls.at(-1)![0].text).toBe("Cuéntame tu problema.");
    const run = await ws.db.flow_runs.findFirstOrThrow({ where: { contact_id: contactId }, orderBy: { started_at: "desc" } });
    expect(run.status).toBe("completed");
  });

  it("re-sends the menu on an unknown reply, then hands off", async () => {
    await say("menu");
    expect(await say("no sé")).toMatchObject({ outcome: "fallback_fired" });
    expect(h.sendText).toHaveBeenCalledTimes(2);
    expect(h.sendText.mock.calls[1][0].text).toContain("1. Ventas");
    expect(await say("???")).toMatchObject({ outcome: "handed_off" });
  });
});

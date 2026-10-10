import { describe, expect, it } from "vitest";
import { matchMenuReply, matchTypedOption, menuOptions, numberedMenuText, typedNumber } from "./options";
import { validateFlowForActivation } from "./validate";

const buttons = {
  node_type: "send_buttons",
  config: {
    text: "¿En qué te puedo ayudar?",
    buttons: [
      { reply_id: "ventas", title: "Ventas", next_node_key: "n_ventas" },
      { reply_id: "soporte", title: "Soporte técnico", next_node_key: "n_soporte" },
      { reply_id: "pagos", title: "Pagos", next_node_key: "n_pagos" },
    ],
  },
};

const list = {
  node_type: "send_list",
  config: {
    text: "Elige",
    button_label: "Ver",
    sections: [
      { title: "A", rows: [{ reply_id: "a1", title: "Uno", next_node_key: "x1" }] },
      { title: "B", rows: [{ reply_id: "b1", title: "Horarios", next_node_key: "x2" }, { reply_id: "b2", title: "Ubicación", next_node_key: "x3" }] },
    ],
  },
};

const text = (t: string) => ({ kind: "text" as const, text: t, meta_message_id: "m" });

describe("menu options", () => {
  it("reads typed numbers in many shapes", () => {
    for (const t of ["2", "2.", " 2) ", "2️⃣", "opción 2", "Opcion #2", "#2", "dos", "Dos!", "la segunda", "segunda opción", "two", "number 2"]) {
      expect(typedNumber(t), t).toBe(2);
    }
    expect(typedNumber("nueve")).toBe(9);
    expect(typedNumber("🔟")).toBe(10);
    expect(typedNumber("hola")).toBeNull();
    expect(typedNumber("no")).toBeNull();
  });

  it("matches a typed number, a title or a title inside a sentence", () => {
    const opts = menuOptions(buttons);
    expect(matchTypedOption(opts, "1")?.reply_id).toBe("ventas");
    expect(matchTypedOption(opts, "tres")?.reply_id).toBe("pagos");
    expect(matchTypedOption(opts, "soporte tecnico")?.reply_id).toBe("soporte");
    expect(matchTypedOption(opts, "Quiero hablar con VENTAS por favor")?.reply_id).toBe("ventas");
    expect(matchTypedOption(opts, "4")).toBeNull();
    expect(matchTypedOption(opts, "ventas o pagos")).toBeNull();
    expect(matchTypedOption(opts, "hola")).toBeNull();
  });

  it("numbers list rows across sections in order", () => {
    expect(matchMenuReply(list, text("3"))).toBe("x3");
    // "uno" is a number word first: it picks option 1, which here is also titled "Uno".
    expect(matchMenuReply(list, text("uno"))).toBe("x1");
    expect(matchMenuReply(list, text("ubicacion"))).toBe("x3");
  });

  it("taps match by id, and fall back to the tapped title", () => {
    expect(matchMenuReply(buttons, { kind: "interactive_reply", reply_id: "pagos", reply_title: "Pagos", meta_message_id: "m" })).toBe("n_pagos");
    expect(matchMenuReply(buttons, { kind: "interactive_reply", reply_id: "old", reply_title: "Ventas", meta_message_id: "m" })).toBe("n_ventas");
    expect(matchMenuReply(buttons, text("2"))).toBe("n_soporte");
    expect(matchMenuReply(buttons, text("gracias"))).toBeNull();
  });

  it("builds the numbered text", () => {
    expect(
      numberedMenuText({ text: "¿En qué te puedo ayudar?", header: "Bienvenido", footer: "Responde con el número de la opción.", options: menuOptions(buttons) }),
    ).toBe("*Bienvenido*\n\n¿En qué te puedo ayudar?\n\n1. Ventas\n2. Soporte técnico\n3. Pagos\n\nResponde con el número de la opción.");
  });

  it("a numbered menu may have up to 10 longer options and no list button label", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ reply_id: `o${i}`, title: `Opción con un título bastante largo ${i}`, next_node_key: "end" }));
    const flow = (cfg: Record<string, unknown>, type = "send_buttons") => [
      { node_key: "start", node_type: "start", config: { next_node_key: "menu" } },
      { node_key: "menu", node_type: type, config: cfg },
      { node_key: "end", node_type: "end", config: {} },
    ];
    const errors = (nodes: ReturnType<typeof flow>) =>
      validateFlowForActivation({ name: "Menú", trigger_type: "manual", trigger_config: {}, entry_node_id: "start" }, nodes).filter((i) => i.severity === "error" && i.node_key === "menu");
    expect(errors(flow({ text: "Elige", buttons: many }))).not.toHaveLength(0);
    expect(errors(flow({ text: "Elige", display: "numbered", buttons: many }))).toHaveLength(0);
    expect(errors(flow({ text: "Elige", display: "numbered", sections: [{ rows: many }] }, "send_list"))).toHaveLength(0);
  });
});

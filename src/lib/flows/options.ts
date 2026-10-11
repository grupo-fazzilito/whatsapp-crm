/**
 * Menu options of a send_buttons / send_list node, as the customer sees
 * them: numbered in order (list rows flattened across sections).
 *
 * The customer can answer a menu by tapping the option (reply_id) or by
 * typing it — "1", "1.", "1️⃣", "opción 2", "dos", "la segunda", or the
 * option's title ("Ventas", "quiero hablar con ventas"). Pure helpers so
 * the builder preview and engine.test.ts can use them.
 */

import type { ParsedInbound, SendButtonsNodeConfig, SendListNodeConfig } from "./types";

export interface MenuOption {
  reply_id: string;
  title: string;
  description?: string;
  next_node_key: string;
}

/** Native buttons/list, or a plain numbered text message. */
export type MenuDisplay = "native" | "numbered";

/** Limits when the menu is sent as numbered text (no Meta button caps). */
export const NUMBERED_LIMITS = {
  maxOptions: 10,
  optionTitleMaxLength: 60,
} as const;

export function menuDisplay(config: Record<string, unknown>): MenuDisplay {
  return config.display === "numbered" ? "numbered" : "native";
}

export function menuOptions(node: { node_type: string; config: Record<string, unknown> }): MenuOption[] {
  if (node.node_type === "send_buttons") {
    return ((node.config as unknown as SendButtonsNodeConfig).buttons ?? []).map((b) => ({ ...b }));
  }
  if (node.node_type === "send_list") {
    return ((node.config as unknown as SendListNodeConfig).sections ?? []).flatMap((s) => (s.rows ?? []).map((r) => ({ ...r })));
  }
  return [];
}

/** The text sent for a numbered menu: header, body, options, footer. */
export function numberedMenuText(args: { text: string; header?: string; footer?: string; options: { title: string; description?: string }[] }): string {
  const lines: string[] = [];
  if (args.header?.trim()) lines.push(`*${args.header.trim()}*`, "");
  lines.push(args.text.trim(), "");
  args.options.forEach((o, i) => lines.push(`${i + 1}. ${o.title.trim()}${o.description?.trim() ? ` — ${o.description.trim()}` : ""}`));
  if (args.footer?.trim()) lines.push("", args.footer.trim());
  return lines.join("\n");
}

const NUMBER_WORDS: Record<string, number> = {
  uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  primero: 1, primera: 1, primer: 1, segundo: 2, segunda: 2, tercero: 3, tercera: 3, tercer: 3,
  cuarto: 4, cuarta: 4, quinto: 5, quinta: 5, sexto: 6, sexta: 6, septimo: 7, septima: 7,
  octavo: 8, octava: 8, noveno: 9, novena: 9, decimo: 10, decima: 10,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};

// Words that may come before the number: "opción 2", "la segunda", "number 3".
// The keyword must be followed by a space or digit, so "nueve" keeps its "n".
const PREFIX = /^(?:(?:la|el|mi|my|the)\s+)?(?:(?:opcion|option|opc|op|numero|number|num|no|n)(?=[\s\d#])\s*)?(?:#\s*)?/;
const SUFFIX = /\s+(?:opcion|option)$/;

/** Lowercase, no accents, emoji keycaps as digits, punctuation as spaces. */
export function normalizeReply(text: string): string {
  return text
    .replace(/(\d)️?⃣/g, "$1")
    .replace(/\u{1F51F}/gu, "10")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}#]+/gu, " ")
    .trim();
}

/** Position (1-based) the customer typed, if the reply is just a number. */
export function typedNumber(text: string): number | null {
  const t = normalizeReply(text).replace(PREFIX, "").replace(SUFFIX, "").trim();
  if (/^\d{1,2}$/.test(t)) return Number(t);
  return NUMBER_WORDS[t] ?? null;
}

/** Which option a typed reply picks, or null. */
export function matchTypedOption<T extends { title: string }>(options: T[], text: string): T | null {
  if (!options.length || !text.trim()) return null;
  const n = typedNumber(text);
  if (n !== null) return n >= 1 && n <= options.length ? options[n - 1] : null;

  const reply = normalizeReply(text);
  const titles = options.map((o) => normalizeReply(o.title));
  const exact = titles.findIndex((t) => t && t === reply);
  if (exact >= 0) return options[exact];

  // "quiero hablar con ventas" → Ventas, only when exactly one title
  // appears as whole words (short titles like "Sí" are too ambiguous).
  const padded = ` ${reply} `;
  const hits = titles.flatMap((t, i) => (t.length >= 3 && padded.includes(` ${t} `) ? [i] : []));
  return hits.length === 1 ? options[hits[0]] : null;
}

/**
 * next_node_key for a customer reply on a menu node: the tapped option,
 * or the option they typed.
 */
export function matchMenuReply(
  node: { node_type: string; config: Record<string, unknown> },
  message: ParsedInbound,
): string | null {
  const options = menuOptions(node);
  if (message.kind === "interactive_reply") {
    const tapped = options.find((o) => o.reply_id === message.reply_id);
    if (tapped) return tapped.next_node_key || null;
    return matchTypedOption(options, message.reply_title)?.next_node_key || null;
  }
  return matchTypedOption(options, message.text)?.next_node_key || null;
}

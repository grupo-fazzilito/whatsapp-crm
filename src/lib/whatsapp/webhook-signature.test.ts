import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// The panel setting lives in the DB: simulate "nothing stored" (env fallback)
// or a stored, encrypted secret.
const stored = vi.hoisted(() => ({ value: null as Record<string, string> | null }));
vi.mock("@/lib/platform/settings", () => ({
  getPlatformSetting: vi.fn(async () => stored.value),
  setPlatformSetting: vi.fn(),
}));

import { encrypt } from "./encryption";
import { claimedAccounts, verifyMetaSignatureWith, verifyMetaWebhook, verifyMetaWebhookSignature } from "./webhook-signature";

const SECRET = process.env.META_APP_SECRET!;

function signedHeader(body: string, secret: string = SECRET): string {
  const hex = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${hex}`;
}

afterEach(() => {
  stored.value = null;
});

describe("verifyMetaWebhookSignature (env fallback)", () => {
  it("accepts a request signed with the correct secret", async () => {
    const body = JSON.stringify({ object: "whatsapp_business_account" });
    expect(await verifyMetaWebhookSignature(body, signedHeader(body))).toBe(true);
  });

  it("rejects a signature computed with a different secret", async () => {
    const body = "{}";
    expect(await verifyMetaWebhookSignature(body, signedHeader(body, "wrong"))).toBe(false);
  });

  it("rejects when the body has been tampered with after signing", async () => {
    const original = '{"entry":[]}';
    const header = signedHeader(original);
    const tampered = '{"entry":[{"id":"injected"}]}';
    expect(await verifyMetaWebhookSignature(tampered, header)).toBe(false);
  });

  it("rejects a missing header", async () => {
    expect(await verifyMetaWebhookSignature("anything", null)).toBe(false);
  });

  it("rejects a header without the sha256= prefix", async () => {
    const body = "{}";
    const hex = crypto.createHmac("sha256", SECRET).update(body).digest("hex");
    expect(await verifyMetaWebhookSignature(body, hex)).toBe(false);
    expect(await verifyMetaWebhookSignature(body, `sha512=${hex}`)).toBe(false);
  });

  it("rejects a header of the wrong length without throwing", async () => {
    // timingSafeEqual would throw on length mismatch — the guard inside
    // the verifier should catch this and return false instead.
    expect(await verifyMetaWebhookSignature("{}", "sha256=tooshort")).toBe(false);
  });

  describe("fail-closed when secret is missing", () => {
    const originalSecret = process.env.META_APP_SECRET;
    beforeEach(() => {
      delete process.env.META_APP_SECRET;
    });
    afterEach(() => {
      process.env.META_APP_SECRET = originalSecret;
    });

    it("rejects even a correctly-formed signature when no secret is configured", async () => {
      const body = "{}";
      const header = signedHeader(body, originalSecret!);
      expect(await verifyMetaWebhookSignature(body, header)).toBe(false);
    });
  });
});

describe("verifyMetaWebhookSignature (admin panel secret)", () => {
  it("uses the panel secret over the env one", async () => {
    stored.value = { app_secret: encrypt("panel-secret") };
    const body = '{"object":"whatsapp_business_account"}';
    expect(await verifyMetaWebhookSignature(body, signedHeader(body, "panel-secret"))).toBe(true);
    expect(await verifyMetaWebhookSignature(body, signedHeader(body))).toBe(false);
  });
});

describe("verifyMetaSignatureWith", () => {
  it("is pure: explicit secret, fail closed without one", () => {
    const body = "{}";
    expect(verifyMetaSignatureWith(body, signedHeader(body, "x"), "x")).toBe(true);
    expect(verifyMetaSignatureWith(body, signedHeader(body, "x"), null)).toBe(false);
  });
});

describe("verifyMetaWebhook (platform app + own-app channels)", () => {
  const wa = (pnids: string[]) =>
    JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: "WABA", changes: pnids.map((p) => ({ field: "messages", value: { metadata: { phone_number_id: p } } })) }],
    });
  const OWN = "0123456789abcdef0123456789abcdef";
  const loader = vi.fn(async (_type: string, ids: string[]) => {
    const all = new Map([["111", OWN], ["222", "another-apps-secret-000000000000"]]);
    return new Map(ids.filter((id) => all.has(id)).map((id) => [id, all.get(id)!] as [string, string]));
  });

  it("accepts platform-signed payloads without touching channel secrets", async () => {
    const body = wa(["111"]);
    const r = await verifyMetaWebhook(body, signedHeader(body, "platform"), { platformSecret: "platform", loadChannelSecrets: loader });
    expect(r).toEqual({ ok: true, via: "platform" });
    expect(loader).not.toHaveBeenCalled();
  });

  it("accepts a payload signed with the channel's own app secret, scoped to that channel", async () => {
    const body = wa(["111"]);
    const r = await verifyMetaWebhook(body, signedHeader(body, OWN), { platformSecret: "platform", loadChannelSecrets: loader });
    expect(r).toEqual({ ok: true, via: "channel", externalIds: ["111"] });
    expect(loader).toHaveBeenCalledWith("whatsapp", ["111"]);
  });

  it("an own app can't smuggle events for another channel: only its accounts are trusted", async () => {
    const body = wa(["111", "222"]);
    const r = await verifyMetaWebhook(body, signedHeader(body, OWN), { platformSecret: null, loadChannelSecrets: loader });
    expect(r).toEqual({ ok: true, via: "channel", externalIds: ["111"] });
  });

  it("rejects a wrong secret and unknown accounts", async () => {
    const body = wa(["111"]);
    expect(await verifyMetaWebhook(body, signedHeader(body, "wrong"), { platformSecret: "platform", loadChannelSecrets: loader })).toEqual({ ok: false });
    const other = wa(["999"]);
    expect(await verifyMetaWebhook(other, signedHeader(other, OWN), { platformSecret: "platform", loadChannelSecrets: loader })).toEqual({ ok: false });
    expect(await verifyMetaWebhook(body, null, { platformSecret: "platform", loadChannelSecrets: loader })).toEqual({ ok: false });
  });

  it("extracts claimed accounts for WhatsApp, Messenger and Instagram; ignores junk", () => {
    expect(claimedAccounts(wa(["111", "111", "222"]))).toEqual({ type: "whatsapp", ids: ["111", "222"] });
    expect(claimedAccounts(JSON.stringify({ object: "page", entry: [{ id: "555" }] }))).toEqual({ type: "messenger", ids: ["555"] });
    expect(claimedAccounts(JSON.stringify({ object: "instagram", entry: [{ id: "777" }, { id: "x'; drop" }] }))).toEqual({ type: "instagram", ids: ["777"] });
    expect(claimedAccounts("not json")).toBeNull();
    expect(claimedAccounts(JSON.stringify({ object: "user" }))).toBeNull();
  });
});

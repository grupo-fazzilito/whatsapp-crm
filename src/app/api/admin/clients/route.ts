import { isPlatformAdmin } from "@/lib/admin/guard";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

function adminClient() {
  return supabaseAdmin();
}

async function isAuthed(): Promise<boolean> {
  return isPlatformAdmin();
}

/**
 * A client row is a workspace. Rows carry the workspace id as `id`;
 * PATCH/DELETE resolve it to the workspace owner's auth user (and still
 * accept a raw auth user id).
 */
async function resolveOwnerUserId(id: string): Promise<string> {
  const { data } = await adminClient()
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", id)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.user_id ?? id;
}

// GET /api/admin/clients
export async function GET() {
  if (!(await isAuthed()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = adminClient();

  const { data: workspaces, error: wsErr } = await db
    .from("workspaces")
    .select("id, name, industry, business_type_detail, city, phone, created_at, created_by")
    .order("created_at", { ascending: false });
  if (wsErr) return NextResponse.json({ error: wsErr.message }, { status: 500 });
  if (!workspaces || workspaces.length === 0) return NextResponse.json({ clients: [] });

  const { data: authData, error: authErr } = await db.auth.admin.listUsers({ perPage: 500 });
  if (authErr) return NextResponse.json({ error: authErr.message }, { status: 500 });
  const userMap = new Map((authData?.users ?? []).map(u => [u.id, u]));

  const wsIds = workspaces.map(w => w.id);

  // Fetch all related data in parallel
  const [owners, profiles, contacts, conversations, waConfigs, broadcasts, automations, clinics] =
    await Promise.all([
      db.from("workspace_members").select("workspace_id, user_id, created_at").eq("role", "owner").in("workspace_id", wsIds).order("created_at", { ascending: true }),
      db.from("profiles").select("user_id, full_name, email, avatar_url, role, created_at"),
      db.from("contacts").select("workspace_id").in("workspace_id", wsIds),
      db.from("conversations").select("workspace_id, status, created_at").in("workspace_id", wsIds),
      db.from("channels").select("workspace_id, type, status, external_id, settings, created_at").in("workspace_id", wsIds).order("created_at"),
      db.from("broadcasts").select("workspace_id, status, total_recipients, sent_count").in("workspace_id", wsIds),
      db.from("automations").select("workspace_id, is_active").in("workspace_id", wsIds),
      // Business profile now lives on the workspace row itself.
      Promise.resolve({ data: workspaces.map((w: { id: string; name: string; business_type_detail?: string | null; industry: string; city?: string | null; phone?: string | null }) => ({ workspace_id: w.id, clinic_name: w.name, clinic_type: w.business_type_detail ?? w.industry, city: w.city ?? null, phone: w.phone ?? null })) }),
    ]);

  // Build lookup maps (first owner wins — rows are ordered oldest first)
  const ownerMap = new Map<string, string>();
  for (const o of (owners.data ?? []))
    if (!ownerMap.has(o.workspace_id)) ownerMap.set(o.workspace_id, o.user_id);
  const profileMap    = new Map((profiles.data    ?? []).map(p => [p.user_id, p]));
  // Per workspace: its first connected WhatsApp channel (or first at all),
  // plus how many channels of any type it has.
  const waMap = new Map<string, { status: string; external_id: string; settings: Record<string, unknown>; created_at: string }>();
  const channelCount = new Map<string, number>();
  for (const ch of (waConfigs.data ?? [])) {
    channelCount.set(ch.workspace_id, (channelCount.get(ch.workspace_id) ?? 0) + 1);
    if (ch.type !== "whatsapp") continue;
    const prev = waMap.get(ch.workspace_id);
    if (!prev || (prev.status !== "connected" && ch.status === "connected")) waMap.set(ch.workspace_id, ch);
  }
  const clinicMap     = new Map((clinics.data     ?? []).map(c => [c.workspace_id, c]));

  const contactCount  = new Map<string, number>();
  const convCount     = new Map<string, number>();
  const openConvCount = new Map<string, number>();
  const broadcastCount= new Map<string, number>();
  const autoCount     = new Map<string, number>();

  for (const c of (contacts.data ?? []))
    contactCount.set(c.workspace_id, (contactCount.get(c.workspace_id) ?? 0) + 1);

  for (const c of (conversations.data ?? [])) {
    convCount.set(c.workspace_id, (convCount.get(c.workspace_id) ?? 0) + 1);
    if (c.status === "open")
      openConvCount.set(c.workspace_id, (openConvCount.get(c.workspace_id) ?? 0) + 1);
  }

  for (const b of (broadcasts.data ?? []))
    broadcastCount.set(b.workspace_id, (broadcastCount.get(b.workspace_id) ?? 0) + 1);

  for (const a of (automations.data ?? []))
    autoCount.set(a.workspace_id, (autoCount.get(a.workspace_id) ?? 0) + 1);

  const clients = workspaces.map(w => {
    const ownerId = ownerMap.get(w.id) ?? w.created_by ?? null;
    const u       = ownerId ? userMap.get(ownerId) : undefined;
    const profile = ownerId ? profileMap.get(ownerId) : undefined;
    const wa      = waMap.get(w.id);
    const clinic  = clinicMap.get(w.id);
    const isBanned = !!(u as any)?.banned_until &&
      new Date((u as any).banned_until) > new Date();

    return {
      id:              w.id,
      workspace_id:    w.id,
      workspace_name:  w.name,
      owner_id:        ownerId,
      name:            profile?.full_name ?? u?.user_metadata?.full_name ?? w.name ?? "",
      email:           u?.email ?? profile?.email ?? "",
      avatar_url:      profile?.avatar_url ?? null,
      role:            profile?.role ?? "user",
      // Account status (owner's auth account)
      is_active:       !!u && !isBanned && !!u.email_confirmed_at,
      is_banned:       isBanned,
      banned_until:    (u as any)?.banned_until ?? null,
      confirmed:       !!u?.email_confirmed_at,
      provider:        u?.app_metadata?.provider ?? "email",
      // Timestamps
      joined_at:       w.created_at,
      last_sign_in:    u?.last_sign_in_at ?? null,
      // WhatsApp
      wa_connected:    wa?.status === "connected",
      wa_status:       wa?.status ?? "disconnected",
      wa_phone_id:     wa?.external_id ?? null,
      wa_waba_id:      (wa?.settings?.waba_id as string | undefined) ?? null,
      wa_connected_at: wa?.created_at ?? null,
      channels_count:  channelCount.get(w.id) ?? 0,
      // Healthcare
      clinic_name:     clinic?.clinic_name ?? null,
      clinic_type:     clinic?.clinic_type ?? null,
      clinic_city:     clinic?.city ?? null,
      clinic_phone:    clinic?.phone ?? null,
      // Stats
      contacts:        contactCount.get(w.id) ?? 0,
      conversations:   convCount.get(w.id) ?? 0,
      open_conversations: openConvCount.get(w.id) ?? 0,
      broadcasts:      broadcastCount.get(w.id) ?? 0,
      automations:     autoCount.get(w.id) ?? 0,
    };
  });

  return NextResponse.json({ clients });
}

// PATCH /api/admin/clients — activate or deactivate a workspace owner's account
export async function PATCH(req: NextRequest) {
  if (!(await isAuthed()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, action } = await req.json() as { id: string; action: "activate" | "deactivate" };
  if (!id || !action)
    return NextResponse.json({ error: "Missing id or action" }, { status: 400 });

  const db = adminClient();
  const userId = await resolveOwnerUserId(id);

  if (action === "deactivate") {
    // Ban for 100 years = effectively permanent until manually lifted
    const { error } = await db.auth.admin.updateUserById(userId, {
      ban_duration: "876000h", // 100 years
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    // Lift ban
    const { error } = await db.auth.admin.updateUserById(userId, {
      ban_duration: "none",
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/admin/clients?id=xxx
export async function DELETE(req: NextRequest) {
  if (!(await isAuthed()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const db = adminClient();
  const { error } = await db.auth.admin.deleteUser(await resolveOwnerUserId(id));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

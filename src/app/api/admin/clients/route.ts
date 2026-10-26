import { isPlatformAdmin } from "@/lib/admin/guard";
import { NextRequest, NextResponse } from "next/server";
import { deleteUser, listUsersForAdmin, setBanned } from "@/lib/auth/users";
import { prisma } from "@/lib/db/prisma";

// Accounts (list, ban, delete) via src/lib/auth/users; data via the platform Prisma client.

async function isAuthed(): Promise<boolean> {
  return isPlatformAdmin();
}

/**
 * A client row is a workspace. Rows carry the workspace id as `id`;
 * PATCH/DELETE resolve it to the workspace owner's auth user (and still
 * accept a raw auth user id).
 */
async function resolveOwnerUserId(id: string): Promise<string> {
  const data = await prisma.workspace_members
    .findFirst({ where: { workspace_id: id, role: "owner" }, select: { user_id: true }, orderBy: { created_at: "asc" } })
    .catch(() => null);
  return data?.user_id ?? id;
}

// GET /api/admin/clients
export async function GET() {
  if (!(await isAuthed()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let workspaces: { id: string; name: string; industry: string; business_type_detail: string | null; city: string | null; phone: string | null; created_at: string | null; created_by: string | null }[];
  try {
    workspaces = (await prisma.workspaces.findMany({
      select: { id: true, name: true, industry: true, business_type_detail: true, city: true, phone: true, created_at: true, created_by: true },
      orderBy: { created_at: "desc" },
    })) as unknown as typeof workspaces;
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
  if (!workspaces || workspaces.length === 0) return NextResponse.json({ clients: [] });

  let authUsers: Awaited<ReturnType<typeof listUsersForAdmin>>;
  try {
    authUsers = await listUsersForAdmin();
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
  const userMap = new Map(authUsers.map(u => [u.id, u]));

  const wsIds = workspaces.map(w => w.id);

  // A failed query reads as no rows, as before.
  const safe = <T,>(p: Promise<T[]>) => p.then((data) => ({ data }), (err) => {
    console.error("[admin/clients] query failed:", err instanceof Error ? err.message : err);
    return { data: null as T[] | null };
  });

  // Fetch all related data in parallel
  const [owners, profiles, contacts, conversations, waConfigs, broadcasts, automations, clinics] =
    await Promise.all([
      safe(prisma.workspace_members.findMany({ select: { workspace_id: true, user_id: true, created_at: true }, where: { role: "owner", workspace_id: { in: wsIds } }, orderBy: { created_at: "asc" } })),
      safe(prisma.profiles.findMany({ select: { user_id: true, full_name: true, email: true, avatar_url: true, role: true, created_at: true } })),
      safe(prisma.contacts.groupBy({ by: ["workspace_id"], where: { workspace_id: { in: wsIds } }, _count: { _all: true } })),
      safe(prisma.conversations.groupBy({ by: ["workspace_id", "status"], where: { workspace_id: { in: wsIds } }, _count: { _all: true } })),
      safe(prisma.channels.findMany({ select: { workspace_id: true, type: true, name: true, display_handle: true, status: true, status_detail: true, external_id: true, settings: true, created_at: true }, where: { workspace_id: { in: wsIds } }, orderBy: { created_at: "asc" } })),
      safe(prisma.broadcasts.groupBy({ by: ["workspace_id"], where: { workspace_id: { in: wsIds } }, _count: { _all: true } })),
      safe(prisma.automations.groupBy({ by: ["workspace_id"], where: { workspace_id: { in: wsIds } }, _count: { _all: true } })),
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
  // Every channel of the workspace (WhatsApp, Messenger, Instagram, web chat…), oldest first.
  const channelsByWs = new Map<string, { type: string; name: string; handle: string | null; status: string; status_detail: string | null; external_id: string; waba_id: string | null; connected_at: string }[]>();
  for (const ch of (waConfigs.data ?? [])) {
    channelCount.set(ch.workspace_id, (channelCount.get(ch.workspace_id) ?? 0) + 1);
    const list = channelsByWs.get(ch.workspace_id) ?? [];
    list.push({
      type: ch.type,
      name: ch.name,
      handle: ch.display_handle ?? null,
      status: ch.status,
      status_detail: ch.status_detail ?? null,
      external_id: ch.external_id,
      waba_id: ((ch.settings ?? {}) as Record<string, unknown>).waba_id as string | null ?? null,
      connected_at: ch.created_at as unknown as string,
    });
    channelsByWs.set(ch.workspace_id, list);
    if (ch.type !== "whatsapp") continue;
    const prev = waMap.get(ch.workspace_id);
    if (!prev || (prev.status !== "connected" && ch.status === "connected"))
      waMap.set(ch.workspace_id, { ...ch, settings: (ch.settings ?? {}) as Record<string, unknown>, created_at: ch.created_at as unknown as string });
  }
  const clinicMap     = new Map((clinics.data     ?? []).map(c => [c.workspace_id, c]));

  const contactCount  = new Map<string, number>();
  const convCount     = new Map<string, number>();
  const openConvCount = new Map<string, number>();
  const broadcastCount= new Map<string, number>();
  const autoCount     = new Map<string, number>();

  // Rows are grouped per workspace (and status) with their counts.
  for (const c of (contacts.data ?? []))
    contactCount.set(c.workspace_id, (contactCount.get(c.workspace_id) ?? 0) + c._count._all);

  for (const c of (conversations.data ?? [])) {
    convCount.set(c.workspace_id, (convCount.get(c.workspace_id) ?? 0) + c._count._all);
    if (c.status === "open")
      openConvCount.set(c.workspace_id, (openConvCount.get(c.workspace_id) ?? 0) + c._count._all);
  }

  for (const b of (broadcasts.data ?? []))
    broadcastCount.set(b.workspace_id, (broadcastCount.get(b.workspace_id) ?? 0) + b._count._all);

  for (const a of (automations.data ?? []))
    autoCount.set(a.workspace_id, (autoCount.get(a.workspace_id) ?? 0) + a._count._all);

  const clients = workspaces.map(w => {
    const ownerId = ownerMap.get(w.id) ?? w.created_by ?? null;
    const u       = ownerId ? userMap.get(ownerId) : undefined;
    const profile = ownerId ? profileMap.get(ownerId) : undefined;
    const wa      = waMap.get(w.id);
    const clinic  = clinicMap.get(w.id);
    const isBanned = !!u?.banned_until && new Date(u.banned_until) > new Date();

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
      banned_until:    u?.banned_until ?? null,
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
      channels:        channelsByWs.get(w.id) ?? [],
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

  const userId = await resolveOwnerUserId(id);
  try {
    // Deactivate = banned until lifted (also ends their sessions).
    await setBanned(userId, action === "deactivate");
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/admin/clients?id=xxx
export async function DELETE(req: NextRequest) {
  if (!(await isAuthed()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  try {
    await deleteUser(await resolveOwnerUserId(id));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

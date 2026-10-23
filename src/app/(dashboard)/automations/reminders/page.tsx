"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { BellRing, Coins, Loader2 } from "lucide-react";
import { useT } from "@/i18n/client";
import { useWorkspace } from "@/hooks/use-workspace";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/components/business/api";
import { cn } from "@/lib/utils";
import { REMINDER_KINDS, REMINDER_PLACEHOLDERS, REMINDER_TEXT_MAX, type ReminderSettings } from "@/lib/bookings/reminder-settings";
import type { ReminderKind } from "@/lib/bookings/reminders";

interface Loaded {
  settings: ReminderSettings;
  defaults: Record<ReminderKind, string>;
  whatsapp: boolean;
  template: { id: string; status: string; rejection_reason: string | null } | null;
}

const STATUS_VARIANT: Record<string, string> = {
  Approved: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  Pending: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  Rejected: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
};

/** Automations → Reminders: booking reminders on/off, their texts and the WhatsApp template. */
export default function RemindersPage() {
  const t = useT();
  const { can, label, modules, refresh } = useWorkspace();
  const isAdmin = can("admin");
  const [data, setData] = useState<Loaded | null>(null);
  const [off, setOff] = useState<ReminderKind[]>([]);
  const [texts, setTexts] = useState<Partial<Record<ReminderKind, string>>>({});
  const [editing, setEditing] = useState<Partial<Record<ReminderKind, boolean>>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/business/reminders", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return;
    const body = (await res.json()) as Loaded;
    setData(body);
    setOff(body.settings.off);
    setTexts(body.settings.texts);
    setEditing(Object.fromEntries(REMINDER_KINDS.map((k) => [k, !!body.settings.texts[k]])));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void load();
  }, [load]);

  const booking = label("booking").toLowerCase();

  if (!modules.bookings) {
    return <p className="text-sm text-muted-foreground">{t("bookings.sendSchedule.bookingsOff")}</p>;
  }
  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label={t("common.loading")} />
      </div>
    );
  }

  const save = async () => {
    setSaving(true);
    try {
      const clean = Object.fromEntries(REMINDER_KINDS.filter((k) => editing[k] && texts[k]?.trim()).map((k) => [k, texts[k]!.trim()]));
      await api("/api/business/workspace", { method: "PATCH", body: { settings: { booking_reminders: { off, texts: clean } } } });
      toast.success(t("bookings.reminders.page.saved"));
      await refresh();
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const tplStatus = data.template?.status ?? "none";

  return (
    <div className="space-y-6">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-bold text-foreground">{t("bookings.reminders.page.title", { bookings: label("bookingPlural") })}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("bookings.reminders.page.description", { booking })}</p>
        <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Coins className="h-4 w-4 text-primary" aria-hidden="true" />
          {t("bookings.reminders.page.cost")}
        </p>
        {!isAdmin && <p className="mt-2 text-sm text-muted-foreground">{t("bookings.reminders.page.readOnly")}</p>}
      </div>

      <section className="grid gap-3">
        {REMINDER_KINDS.map((kind) => {
          const on = !off.includes(kind);
          const id = `reminder-text-${kind}`;
          return (
            <div key={kind} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="inline-flex items-center gap-2 font-semibold text-foreground">
                  <BellRing className="h-4 w-4 text-primary" aria-hidden="true" />
                  {t(`bookings.reminders.page.kind.${kind}`)}
                </h2>
                <Switch
                  checked={on}
                  disabled={!isAdmin}
                  onCheckedChange={(v) => setOff((prev) => (v ? prev.filter((k) => k !== kind) : [...prev, kind]))}
                  aria-label={t(`bookings.reminders.page.kind.${kind}`)}
                />
              </div>
              {on && (
                <div className="mt-3 grid gap-2">
                  {editing[kind] ? (
                    <>
                      <label htmlFor={id} className="text-sm font-medium text-foreground">
                        {t("bookings.reminders.page.customText")}
                      </label>
                      <Textarea
                        id={id}
                        rows={4}
                        maxLength={REMINDER_TEXT_MAX}
                        value={texts[kind] ?? ""}
                        disabled={!isAdmin}
                        onChange={(e) => setTexts((prev) => ({ ...prev, [kind]: e.target.value }))}
                      />
                      <p className="text-xs text-muted-foreground">
                        {t("bookings.reminders.page.placeholders", { list: REMINDER_PLACEHOLDERS.map((p) => `{${p}}`).join(" ") })}
                      </p>
                      {isAdmin && (
                        <button
                          type="button"
                          className="justify-self-start text-xs font-medium text-primary underline-offset-2 hover:underline"
                          onClick={() => setEditing((prev) => ({ ...prev, [kind]: false }))}
                        >
                          {t("bookings.reminders.page.reset")}
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">{t("bookings.reminders.page.defaultText")}</p>
                      <p className="whitespace-pre-wrap rounded-lg bg-muted/60 p-3 text-sm text-foreground">{data.defaults[kind]}</p>
                      {isAdmin && (
                        <button
                          type="button"
                          className="justify-self-start text-xs font-medium text-primary underline-offset-2 hover:underline"
                          onClick={() => {
                            setTexts((prev) => ({ ...prev, [kind]: prev[kind]?.trim() ? prev[kind] : t(`bookings.reminders.suggested.${kind}`) }));
                            setEditing((prev) => ({ ...prev, [kind]: true }));
                          }}
                        >
                          {t("bookings.reminders.page.useSuggested")}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <p className="text-xs text-muted-foreground">{t("bookings.reminders.page.kindHelp", { booking })}</p>
        {isAdmin && (
          <div>
            <Button onClick={() => void save()} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {t("bookings.reminders.page.save")}
            </Button>
          </div>
        )}
      </section>

      <section className="max-w-3xl rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-foreground">{t("bookings.reminders.page.template.title")}</h2>
          {data.whatsapp && (
            <Badge variant="outline" className={cn(STATUS_VARIANT[tplStatus])}>
              {t(`bookings.reminders.page.template.status.${tplStatus}`)}
            </Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t("bookings.reminders.page.template.description")}</p>
        {!data.whatsapp ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("bookings.reminders.page.template.noWhatsapp")}</p>
        ) : (
          <>
            {data.template?.rejection_reason && <p className="mt-2 text-sm text-red-700 dark:text-red-300">{data.template.rejection_reason}</p>}
            {data.template && (
              <Link href={`/settings/templates/${data.template.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3")}>
                {t("bookings.reminders.page.template.open")}
              </Link>
            )}
          </>
        )}
      </section>
    </div>
  );
}

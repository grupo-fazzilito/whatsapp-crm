"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CalendarClock, Loader2 } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { useWorkspace } from "@/hooks/use-workspace";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface Option {
  id: string;
  name: string;
}

interface StaffOption extends Option {
  service_ids: string[];
}

interface ScheduleMeta {
  needs_staff: boolean;
  needs_product: boolean;
  calendly_service_ids: string[];
  google_staff_ids: string[];
}

interface Loaded {
  meta: ScheduleMeta;
  services: Option[];
  staff: StaffOption[];
  products: Option[];
}

const fieldClass =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Composer button: sends the customer the booking picker (they pick day
 * and time by tapping, without the AI). The team member can fix the
 * service / staff member / listing first, or leave it to the customer.
 */
export function SendScheduleButton({ conversationId, disabled }: { conversationId: string; disabled?: boolean }) {
  const { t } = useI18n();
  const { modules, label } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Loaded | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [productId, setProductId] = useState("");
  const [busy, setBusy] = useState(false);

  if (!modules.bookings) return null;

  async function load() {
    const [meta, options] = await Promise.all([
      fetch(`/api/conversations/${conversationId}/booking-picker`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/bookings/options?products=1", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
    ]).catch(() => [null, null]);
    if (!meta || !options) {
      toast.error(t("bookings.sendSchedule.error"));
      setOpen(false);
      return;
    }
    setData({
      meta,
      services: (options.services ?? []).filter((s: { is_active?: boolean }) => s.is_active !== false),
      staff: options.staff ?? [],
      products: options.products ?? [],
    });
  }

  function openDialog() {
    setServiceId("");
    setStaffId("");
    setProductId("");
    setData(null);
    setOpen(true);
    void load();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/booking-picker`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service_id: serviceId || null, staff_id: staffId || null, product_id: productId || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const key =
          body.error === "window_closed"
            ? "windowClosed"
            : body.error === "bookings_off"
              ? "bookingsOff"
              : body.error === "no_slots"
                ? "noSlots"
                : "error";
        toast.error(t(`bookings.sendSchedule.${key}`));
        return;
      }
      toast.success(t("bookings.sendSchedule.sent"));
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  const isCalendly = !!serviceId && !!data?.meta.calendly_service_ids.includes(serviceId);
  const staffForService = (data?.staff ?? []).filter(
    (s) => !serviceId || s.service_ids.length === 0 || s.service_ids.includes(serviceId),
  );
  const showStaff = !!data && modules.staff && staffForService.length > 0 && !isCalendly;
  const hasGoogle = !!data && data.meta.google_staff_ids.length > 0;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-9 w-9 shrink-0 p-0 text-slate-400 hover:text-white"
        onClick={openDialog}
        disabled={disabled}
        title={t("bookings.sendSchedule.button")}
        aria-label={t("bookings.sendSchedule.button")}
      >
        <CalendarClock className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t("bookings.sendSchedule.title")}</DialogTitle>
              <DialogDescription>
                {t("bookings.sendSchedule.description", { bookings: label("bookingPlural") })}
                {data && data.meta.calendly_service_ids.length > 0 && <> {t("bookings.sendSchedule.calendly")}</>}
                {hasGoogle && <> {t("bookings.sendSchedule.google")}</>}
              </DialogDescription>
            </DialogHeader>

            {!data ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {t("common.loading")}
              </p>
            ) : (
              <>
                {data.meta.needs_product && data.products.length > 0 && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="schedule-product">{label("product")}</Label>
                    <select id="schedule-product" value={productId} onChange={(e) => setProductId(e.target.value)} className={fieldClass}>
                      <option value="">{t("bookings.sendSchedule.customerChooses")}</option>
                      {data.products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {modules.services && data.services.length > 0 && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="schedule-service">{label("service")}</Label>
                    <select
                      id="schedule-service"
                      value={serviceId}
                      onChange={(e) => {
                        setServiceId(e.target.value);
                        setStaffId("");
                      }}
                      className={fieldClass}
                    >
                      <option value="">{t("bookings.sendSchedule.customerChooses")}</option>
                      {data.services.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                          {data.meta.calendly_service_ids.includes(s.id) ? " · Calendly" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {showStaff && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="schedule-staff">{label("staff")}</Label>
                    <select id="schedule-staff" value={staffId} onChange={(e) => setStaffId(e.target.value)} className={fieldClass}>
                      <option value="">
                        {data.meta.needs_staff ? t("bookings.sendSchedule.customerChooses") : t("bookings.sendSchedule.anyStaff")}
                      </option>
                      {staffForService.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={!data || busy}>
                {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
                {t("bookings.sendSchedule.send")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

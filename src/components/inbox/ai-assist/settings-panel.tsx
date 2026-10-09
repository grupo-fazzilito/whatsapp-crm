"use client";

import { useEffect, useId, useState } from "react";
import { ChevronDown, ChevronUp, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n/client";
import { assistFetch } from "./api";

interface SettingsResponse {
  settings: { auto_transcribe: boolean; auto_read_images: boolean };
  capabilities: { text: boolean; audio: boolean; vision: boolean };
}

/** Workspace switches (admins edit) + which provider capabilities exist. */
export function AssistSettings({ canManage }: { canManage: boolean }) {
  const { t } = useI18n();
  const regionId = useId();
  const transcribeId = useId();
  const imagesId = useId();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<SettingsResponse | null>(null);

  useEffect(() => {
    if (!open || data) return;
    let cancelled = false;
    void assistFetch<SettingsResponse>("settings", { method: "GET" }).then((r) => {
      if (!cancelled && r.ok) setData(r.data);
    });
    return () => {
      cancelled = true;
    };
  }, [open, data]);

  const save = async (key: "auto_transcribe" | "auto_read_images", value: boolean) => {
    if (!data) return;
    const prev = data;
    setData({ ...data, settings: { ...data.settings, [key]: value } });
    const r = await assistFetch<{ settings: SettingsResponse["settings"] }>("settings", { method: "PATCH", body: { [key]: value } });
    if (!r.ok) {
      setData(prev);
      toast.error(t("aiassist.settings.saveFailed"));
      return;
    }
    setData({ ...prev, settings: r.data.settings });
    toast.success(t("aiassist.settings.saved"));
  };

  const cap = (ok: boolean | undefined) => (ok ? t("aiassist.settings.available") : t("aiassist.settings.unavailable"));

  return (
    <div className="border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={regionId}
        className="inline-flex items-center gap-1.5 rounded text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
        {t("aiassist.settings.open")}
        {open ? <ChevronUp className="h-3 w-3" aria-hidden="true" /> : <ChevronDown className="h-3 w-3" aria-hidden="true" />}
      </button>
      {open && (
        <div id={regionId} className="mt-3 grid gap-3 text-sm">
          {!data ? (
            <p className="text-xs text-muted-foreground">…</p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <label htmlFor={transcribeId} className="font-medium">
                    {t("aiassist.settings.autoTranscribe")}
                  </label>
                  <p className="text-xs text-muted-foreground">{t("aiassist.settings.autoTranscribeHint")}</p>
                </div>
                <Switch
                  id={transcribeId}
                  checked={data.settings.auto_transcribe}
                  disabled={!canManage}
                  onCheckedChange={(v) => void save("auto_transcribe", v === true)}
                />
              </div>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <label htmlFor={imagesId} className="font-medium">
                    {t("aiassist.settings.autoReadImages")}
                  </label>
                  <p className="text-xs text-muted-foreground">{t("aiassist.settings.autoReadImagesHint")}</p>
                </div>
                <Switch
                  id={imagesId}
                  checked={data.settings.auto_read_images}
                  disabled={!canManage}
                  onCheckedChange={(v) => void save("auto_read_images", v === true)}
                />
              </div>
              {!canManage && <p className="text-xs text-muted-foreground">{t("aiassist.settings.adminOnly")}</p>}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("aiassist.settings.providers")}</p>
                <ul className="mt-1 grid gap-0.5 text-xs">
                  <li>
                    {t("aiassist.settings.text")}: {cap(data.capabilities.text)}
                  </li>
                  <li>
                    {t("aiassist.settings.audio")}: {cap(data.capabilities.audio)}
                  </li>
                  <li>
                    {t("aiassist.settings.vision")}: {cap(data.capabilities.vision)}
                  </li>
                </ul>
                {!data.capabilities.audio && <p className="mt-1 text-xs text-amber-300">{t("aiassist.errors.noAudioProvider")}</p>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

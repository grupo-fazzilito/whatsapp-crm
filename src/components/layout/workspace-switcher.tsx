"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/hooks/use-workspace";
import { useI18n } from "@/i18n/client";
import { PRESETS } from "@/lib/industries";
import { COUNTRIES, countryDefaults } from "@/lib/workspace/countries";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

export function WorkspaceSwitcher() {
  const { workspace, memberships, role, switchWorkspace } = useWorkspace();
  const { t, locale } = useI18n();
  const [createOpen, setCreateOpen] = useState(false);

  if (!workspace) return null;
  const industry = PRESETS.find((p) => p.id === workspace.industry);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t("workspace.switch")}
          className="flex w-full items-center gap-2.5 rounded-lg border border-sidebar-border px-2.5 py-2 text-left transition-colors hover:bg-sidebar-accent focus:outline-none"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary">
            {initials(workspace.name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-sidebar-foreground">{workspace.name}</span>
            <span className="block truncate text-xs text-sidebar-foreground/60">
              {industry?.name[locale]} · {role ? t(`roles.${role}`) : ""}
            </span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-sidebar-foreground/50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={6}
          className="min-w-60 border border-border bg-popover text-popover-foreground"
        >
          {memberships.map((m) => (
            <DropdownMenuItem
              key={m.workspace.id}
              onClick={() => m.workspace.id !== workspace.id && switchWorkspace(m.workspace.id)}
              className="text-foreground focus:bg-accent focus:text-foreground"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded bg-primary/10 text-[10px] font-semibold text-primary">
                {initials(m.workspace.name)}
              </span>
              <span className="flex-1 truncate">{m.workspace.name}</span>
              {m.workspace.id === workspace.id && <Check className="size-4" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator className="bg-border" />
          <DropdownMenuItem
            onClick={() => setCreateOpen(true)}
            className="text-foreground focus:bg-accent focus:text-foreground"
          >
            <Plus className="size-4" />
            {t("workspace.create")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

function CreateWorkspaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t, locale } = useI18n();
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("generic");
  const [country, setCountry] = useState("MX");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const d = countryDefaults(country);
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          industry,
          country,
          currency: d.currency,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || d.timezone,
          locale,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      window.location.href = "/dashboard";
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
      setSaving(false);
    }
  };

  const selectClass =
    "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("workspace.createTitle")}</DialogTitle>
            <DialogDescription>{t("workspace.createDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="ws-name">{t("workspace.name")}</Label>
            <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-industry">{t("workspace.industry")}</Label>
            <select id="ws-industry" className={selectClass} value={industry} onChange={(e) => setIndustry(e.target.value)}>
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name[locale]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-country">{t("workspace.country")}</Label>
            <select id="ws-country" className={selectClass} value={country} onChange={(e) => setCountry(e.target.value)}>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name[locale]} ({c.currency})
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? t("common.saving") : t("common.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

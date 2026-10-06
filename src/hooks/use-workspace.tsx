"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { readWorkspaceCookie } from "@/lib/supabase/client";
import { hasRole, type WorkspaceRole } from "@/lib/workspace/constants";
import type { Workspace } from "@/lib/workspace/types";
import { industryLabel, resolveIndustry, type IndustryLabels, type ModuleKey } from "@/lib/industries";
import { useI18n } from "@/i18n/client";

export interface MembershipSummary {
  role: WorkspaceRole;
  workspace: Pick<Workspace, "id" | "name" | "industry" | "logo_url">;
}

interface WorkspaceContextValue {
  workspace: Workspace | null;
  role: WorkspaceRole | null;
  memberships: MembershipSummary[];
  loading: boolean;
  /** Set when the signed-in user has no workspace at all. */
  missing: boolean;
  can: (min: WorkspaceRole) => boolean;
  /** Effective module switches (industry preset + workspace overrides). */
  modules: Record<ModuleKey, boolean>;
  /** Industry noun in the current UI locale, e.g. label("staffPlural"). */
  label: (key: keyof IndustryLabels) => string;
  switchWorkspace: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

// The browser Supabase client reads the workspace cookie once, when it is
// created. Remember what it saw so we can reload if the server corrects it.
const cookieAtBoot = typeof document !== "undefined" ? readWorkspaceCookie() : null;

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { locale } = useI18n();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [role, setRole] = useState<WorkspaceRole | null>(null);
  const [memberships, setMemberships] = useState<MembershipSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/workspaces", { cache: "no-store" });
      if (res.status === 404) {
        setMissing(true);
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      if (data.workspace.id !== cookieAtBoot) {
        // The client was created unscoped (or for a workspace the user
        // left). The response fixed the cookie; start over cleanly.
        window.location.reload();
        return;
      }
      setWorkspace(data.workspace);
      setRole(data.role);
      setMemberships(data.memberships);
      setMissing(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const switchWorkspace = useCallback(async (id: string) => {
    const res = await fetch("/api/workspaces/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: id }),
    });
    if (res.ok) window.location.href = "/dashboard";
  }, []);

  const value = useMemo<WorkspaceContextValue>(() => {
    const industry = workspace?.industry ?? "generic";
    const settings = workspace?.settings ?? null;
    return {
      workspace,
      role,
      memberships,
      loading,
      missing,
      can: (min) => hasRole(role, min),
      modules: resolveIndustry(industry, settings).modules,
      label: (key) => industryLabel(industry, key, locale, settings),
      switchWorkspace,
      refresh,
    };
  }, [workspace, role, memberships, loading, missing, locale, switchWorkspace, refresh]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return ctx;
}

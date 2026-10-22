"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { authClient } from "@/lib/auth/client";

/** Signed-in account (fields the UI reads; same names Supabase used). */
export interface User {
  id: string;
  email: string;
  created_at: string | null;
  user_metadata: { full_name?: string };
}

interface Profile {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  role: string | null;
  is_platform_admin: boolean;
  locale: string;
  /**
   * Opted-in beta feature keys for this account. No current feature
   * reads this — Flows was the last user and went to soft-GA in PR
   * #134 — but the column survives for future beta gates.
   */
  beta_features: string[];
  /** When the guided tour was finished or skipped (null = show it). */
  tour_completed_at: string | null;
  /** When the assisted-setup offer was answered (null = not shown yet). */
  setup_offer_seen_at: string | null;
}

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  /**
   * Session-level loading. Flips to false as soon as we know whether
   * a user is signed in, *without* waiting for the profile row. Use
   * this for chrome (sidebar / header) that can render with just the
   * user object.
   */
  loading: boolean;
  /**
   * Profile-row loading. Stays true until `fetchProfile` settles
   * (success, missing row, or error). Code that branches on
   * `profile.beta_features` MUST gate on this — otherwise it sees the
   * `{ loading: false, profile: null }` window during initial load
   * and may take the "not opted in" branch incorrectly.
   */
  profileLoading: boolean;
  /** A platform admin opened this account ("Entrar como cliente"). */
  impersonating: boolean;
  signOut: () => Promise<void>;
  /** Re-fetch the current user's profile row — call after a save from
   *  the settings form so header/sidebar reflect the change without a
   *  full page reload. */
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Ends an admin's visit to a customer account and returns to the admin panel. */
export async function stopImpersonating(): Promise<void> {
  const res = await fetch("/api/auth/whasalia/stop-impersonating", { method: "POST" }).catch(() => null);
  const data = (await res?.json().catch(() => null)) as { signedOut?: boolean } | null;
  window.location.href = data?.signedOut ? "/admin-panel/login" : "/admin-panel";
}

/**
 * AuthProvider — wrap this around the dashboard layout.
 * One /api/me call for the whole tree (session + profile together).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);
  const [impersonating, setImpersonating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/me", { cache: "no-store" });
      if (!res.ok) {
        setUser(null);
        setProfile(null);
        return;
      }
      const data = (await res.json()) as { user: User; profile: Profile | null; impersonating?: boolean };
      setUser(data.user);
      setImpersonating(!!data.impersonating);
      setProfile(data.profile ? { ...data.profile, beta_features: data.profile.beta_features ?? [] } : null);
    } catch (err) {
      console.error("[AuthProvider] /api/me failed:", err);
    } finally {
      setLoading(false);
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial session load
    void load();
  }, [load]);

  const signOut = useCallback(async () => {
    // An admin viewing this account goes back to the admin panel instead.
    if (impersonating) return stopImpersonating();
    await authClient.signOut().catch(() => {});
    setUser(null);
    setProfile(null);
    window.location.href = "/login";
  }, [impersonating]);

  const refreshProfile = useCallback(async () => {
    setProfileLoading(true);
    await load();
  }, [load]);

  return (
    <AuthContext.Provider
      value={{ user, profile, loading, profileLoading, impersonating, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/**
 * useAuth — read the shared auth state from context.
 * Must be used inside an <AuthProvider>.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    // Fallback for components rendered outside the provider (shouldn't
    // happen in normal flow, but don't crash the page).
    return {
      user: null,
      profile: null,
      loading: false,
      profileLoading: false,
      impersonating: false,
      signOut: async () => {
        window.location.href = "/login";
      },
      refreshProfile: async () => {},
    };
  }
  return ctx;
}

"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Users } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthLogo } from "@/components/auth/auth-logo";

interface Preview {
  workspace_name: string;
  email: string;
  role: "admin" | "agent";
}

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { t } = useI18n();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null | undefined>(undefined);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/invitations/${encodeURIComponent(token)}`)
      .then(async (r) => (r.ok ? setPreview(await r.json()) : setInvalid(true)))
      .catch(() => setInvalid(true));
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { user?: { email?: string } } | null) => setUserEmail(d?.user?.email ?? null))
      .catch(() => setUserEmail(null));
  }, [token]);

  const accept = async () => {
    setAccepting(true);
    setError(null);
    const res = await fetch(`/api/invitations/${encodeURIComponent(token)}`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? t("common.error"));
      setAccepting(false);
      return;
    }
    window.location.href = "/dashboard";
  };

  const here = `/invite/${encodeURIComponent(token)}`;
  const loading = (!preview && !invalid) || userEmail === undefined;
  const sameAccount =
    !!preview && !!userEmail && userEmail.toLowerCase() === preview.email.toLowerCase();

  return (
    <div className="relative flex w-full flex-1 flex-col items-center justify-center gap-6 px-4 py-12 min-h-[calc(100dvh-4rem)]">
      <AuthLogo />
      <Card className="w-full max-w-md border-[var(--m-border-primary)] bg-[var(--m-bg-glass)] backdrop-blur-xl">
        {loading ? (
          <CardContent className="flex justify-center py-12">
            <Loader2 className="size-6 animate-spin text-[var(--m-text-muted)]" />
          </CardContent>
        ) : invalid || !preview ? (
          <CardContent className="py-10 text-center text-sm text-[var(--m-text-secondary)]">
            {t("invite.invalid")}
          </CardContent>
        ) : (
          <>
            <CardHeader className="text-center">
              <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-emerald-500/10">
                <Users className="size-6 text-emerald-500" />
              </div>
              <CardTitle className="text-[var(--m-text-primary)]">
                {t("invite.title", { workspace: preview.workspace_name })}
              </CardTitle>
              <CardDescription className="text-[var(--m-text-secondary)]">
                {t("invite.body", { role: t(`roles.${preview.role}`), email: preview.email })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {error && <p className="text-center text-sm text-red-500">{error}</p>}
              {sameAccount ? (
                <Button className="w-full" onClick={accept} disabled={accepting}>
                  {accepting && <Loader2 className="size-4 animate-spin" />}
                  {t("invite.accept")}
                </Button>
              ) : userEmail ? (
                <p className="text-center text-sm text-[var(--m-text-secondary)]">
                  {t("invite.wrongAccount", { email: preview.email })}
                </p>
              ) : (
                <>
                  <Link
                    className={buttonVariants({ className: "w-full" })}
                    href={`/signup?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(preview.email)}`}
                  >
                    {t("invite.createAccount")}
                  </Link>
                  <Link
                    className={buttonVariants({ variant: "outline", className: "w-full" })}
                    href={`/login?next=${encodeURIComponent(here)}`}
                  >
                    {t("invite.signInToAccept", { email: preview.email })}
                  </Link>
                </>
              )}
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}

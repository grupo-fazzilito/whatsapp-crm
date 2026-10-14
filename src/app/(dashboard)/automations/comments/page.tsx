"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ImageOff, Loader2, MessageSquareReply, Pencil, Plus, Trash2 } from "lucide-react";
import { useT } from "@/i18n/client";
import { useWorkspace } from "@/hooks/use-workspace";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CHANNEL_STYLE, selectClass } from "@/components/channels/channel-types";
import { cn } from "@/lib/utils";

interface Rule {
  id: string;
  name: string;
  channel_id: string | null;
  post_id: string | null;
  post_label: string | null;
  keywords: string[];
  public_replies: string[];
  private_message: string | null;
  enabled: boolean;
  replies_count: number;
  last_triggered_at: string | null;
}

interface CommentChannel {
  id: string;
  type: "instagram" | "messenger";
  name: string;
  display_handle: string | null;
  status: string;
}

interface ReplyLog {
  id: string;
  channel_id: string;
  author_name: string | null;
  comment_text: string | null;
  status: "replied" | "partial" | "failed" | "skipped" | "no_tokens";
  error: string | null;
  conversation_id: string | null;
  created_at: string;
  comment_rules: { name: string } | null;
}

interface Post {
  id: string;
  text: string;
  imageUrl: string | null;
  permalink: string | null;
}

interface Draft {
  id: string | null;
  name: string;
  channel_id: string;
  post_id: string | null;
  post_label: string | null;
  keywords: string;
  public_replies: string[];
  private_message: string;
  enabled: boolean;
}

const EMPTY: Draft = { id: null, name: "", channel_id: "", post_id: null, post_label: null, keywords: "", public_replies: [""], private_message: "", enabled: true };

const STATUS_VARIANT: Record<ReplyLog["status"], "default" | "secondary" | "destructive" | "outline"> = {
  replied: "default",
  partial: "outline",
  failed: "destructive",
  skipped: "secondary",
  no_tokens: "destructive",
};

/** Facebook pages are "messenger" channels; here they are about posts, so call them Facebook. */
function channelLabel(c: CommentChannel | undefined) {
  if (!c) return "";
  const net = c.type === "instagram" ? "Instagram" : "Facebook";
  return `${net} · ${c.display_handle ? `@${c.display_handle.replace(/^@/, "")}` : c.name}`;
}

function when(iso: string | null, locale: string) {
  if (!iso) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

export default function CommentRulesPage() {
  const t = useT();
  const { can, workspace } = useWorkspace();
  const isAdmin = can("admin");
  const locale = workspace?.locale === "en" ? "en" : "es";
  const [data, setData] = useState<{ rules: Rule[]; channels: CommentChannel[]; replies: ReplyLog[] } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Rule | null>(null);
  const [posts, setPosts] = useState<{ state: "idle" | "loading" | "ready" | "error"; list: Post[]; error?: string }>({ state: "idle", list: [] });

  const load = useCallback(async () => {
    const res = await fetch("/api/comment-rules", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void load();
  }, [load]);

  const channelsById = new Map((data?.channels ?? []).map((c) => [c.id, c]));

  const openEditor = (rule?: Rule) => {
    setFormError(null);
    setPosts({ state: "idle", list: [] });
    setDraft(
      rule
        ? {
            id: rule.id,
            name: rule.name,
            channel_id: rule.channel_id ?? "",
            post_id: rule.post_id,
            post_label: rule.post_label,
            keywords: rule.keywords.join(", "),
            public_replies: rule.public_replies.length ? rule.public_replies : [""],
            private_message: rule.private_message ?? "",
            enabled: rule.enabled,
          }
        : { ...EMPTY, channel_id: data?.channels.length === 1 ? data.channels[0].id : "" },
    );
  };

  const loadPosts = async (channelId: string) => {
    setPosts({ state: "loading", list: [] });
    const res = await fetch(`/api/comment-rules/posts?channel_id=${channelId}`, { cache: "no-store" }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (res?.ok) setPosts({ state: "ready", list: body.posts ?? [] });
    else setPosts({ state: "error", list: [], error: body.error === "reconnect" ? t("comments.form.postsReconnect") : t("comments.form.postsError") });
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setFormError(null);
    const payload = {
      name: draft.name,
      channel_id: draft.channel_id || null,
      post_id: draft.channel_id ? draft.post_id : null,
      post_label: draft.channel_id && draft.post_id ? draft.post_label : null,
      keywords: draft.keywords.split(",").map((k) => k.trim()).filter(Boolean),
      public_replies: draft.public_replies.map((r) => r.trim()).filter(Boolean),
      private_message: draft.private_message.trim() || null,
      enabled: draft.enabled,
    };
    const res = await fetch(draft.id ? `/api/comment-rules/${draft.id}` : "/api/comment-rules", {
      method: draft.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);
    setSaving(false);
    if (res?.ok) {
      toast.success(t("comments.saved"));
      setDraft(null);
      void load();
      return;
    }
    const body = res ? await res.json().catch(() => ({})) : {};
    const key = ["name", "reply", "too_long", "channel"].includes(body.error) ? body.error : "generic";
    setFormError(t(`comments.form.errors.${key}`));
  };

  const toggle = async (rule: Rule, enabled: boolean) => {
    setData((d) => d && { ...d, rules: d.rules.map((r) => (r.id === rule.id ? { ...r, enabled } : r)) });
    const res = await fetch(`/api/comment-rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }).catch(() => null);
    if (!res?.ok) {
      toast.error(t("comments.form.errors.generic"));
      void load();
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    const res = await fetch(`/api/comment-rules/${toDelete.id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) toast.success(t("comments.deleted"));
    else toast.error(t("comments.form.errors.generic"));
    void load();
  };

  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label={t("common.loading")} />
      </div>
    );
  }

  const noChannels = data.channels.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-bold text-foreground">{t("comments.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("comments.subtitle")}</p>
        </div>
        {isAdmin && !noChannels && (
          <Button onClick={() => openEditor()}>
            <Plus className="h-4 w-4" aria-hidden /> {t("comments.newRule")}
          </Button>
        )}
      </div>

      {noChannels ? (
        <div className="rounded-xl border border-border bg-card p-6 text-sm">
          <p className="text-muted-foreground">{t("comments.noChannels")}</p>
          <Link href="/channels" className={cn(buttonVariants({ variant: "outline" }), "mt-3")}>
            {t("comments.goChannels")}
          </Link>
        </div>
      ) : (
        <>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>{t("comments.reconnectTip")}</li>
            <li>{t("comments.tiktokSoon")}</li>
          </ul>

          {data.rules.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">{t("comments.empty")}</div>
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2">
              {data.rules.map((rule) => {
                const ch = rule.channel_id ? channelsById.get(rule.channel_id) : undefined;
                return (
                  <li key={rule.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate font-semibold text-foreground">{rule.name}</h2>
                        <p className="text-xs text-muted-foreground">
                          {rule.channel_id ? channelLabel(ch) : t("comments.allAccounts")} ·{" "}
                          {rule.post_id ? `${t("comments.onePost")}${rule.post_label ? `: “${rule.post_label}”` : ""}` : t("comments.allPosts")}
                        </p>
                      </div>
                      <Switch
                        checked={rule.enabled}
                        disabled={!isAdmin}
                        onCheckedChange={(v) => toggle(rule, v)}
                        aria-label={`${t("comments.enabled")}: ${rule.name}`}
                      />
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {rule.keywords.length === 0 ? (
                        <Badge variant="secondary">{t("comments.anyComment")}</Badge>
                      ) : (
                        rule.keywords.map((k) => (
                          <Badge key={k} variant="outline">
                            {k}
                          </Badge>
                        ))
                      )}
                    </div>
                    <dl className="space-y-1 text-sm">
                      <div className="flex gap-2">
                        <dt className="sr-only">{t("comments.form.public")}</dt>
                        <dd className="text-muted-foreground">
                          {rule.public_replies.length === 0
                            ? t("comments.noPublic")
                            : rule.public_replies.length === 1
                              ? t("comments.publicOne")
                              : t("comments.publicCount", { count: rule.public_replies.length })}
                        </dd>
                      </div>
                      <div>
                        <dt className="sr-only">{t("comments.privateMsg")}</dt>
                        <dd className="line-clamp-2 text-foreground">{rule.private_message || <span className="text-muted-foreground">{t("comments.noPrivate")}</span>}</dd>
                      </div>
                    </dl>
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
                      <span>
                        {t("comments.stats", { count: rule.replies_count })}
                        {rule.last_triggered_at ? ` · ${t("comments.lastAt", { when: when(rule.last_triggered_at, locale) })}` : ""}
                      </span>
                      {isAdmin && (
                        <span className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openEditor(rule)}>
                            <Pencil className="h-3.5 w-3.5" aria-hidden /> {t("comments.edit")}
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setToDelete(rule)}>
                            <Trash2 className="h-3.5 w-3.5" aria-hidden /> {t("comments.delete")}
                          </Button>
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <section aria-labelledby="comment-activity" className="space-y-3">
            <h2 id="comment-activity" className="text-sm font-semibold text-foreground">
              {t("comments.activity.title")}
            </h2>
            {data.replies.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("comments.activity.empty")}</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">{t("comments.activity.when")}</th>
                      <th scope="col" className="px-3 py-2 font-medium">{t("comments.activity.who")}</th>
                      <th scope="col" className="px-3 py-2 font-medium">{t("comments.activity.comment")}</th>
                      <th scope="col" className="px-3 py-2 font-medium">{t("comments.activity.rule")}</th>
                      <th scope="col" className="px-3 py-2 font-medium">{t("comments.activity.result")}</th>
                      <th scope="col" className="px-3 py-2"><span className="sr-only">{t("comments.activity.open")}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.replies.map((r) => {
                      const ch = channelsById.get(r.channel_id);
                      const Icon = ch ? CHANNEL_STYLE[ch.type].icon : MessageSquareReply;
                      return (
                        <tr key={r.id} className="border-t border-border align-top">
                          <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{when(r.created_at, locale)}</td>
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center gap-1.5">
                              <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-label={ch?.type === "instagram" ? "Instagram" : "Facebook"} />
                              {r.author_name ?? "—"}
                            </span>
                          </td>
                          <td className="max-w-xs px-3 py-2"><span className="line-clamp-2">{r.comment_text}</span></td>
                          <td className="px-3 py-2 text-muted-foreground">{r.comment_rules?.name ?? "—"}</td>
                          <td className="px-3 py-2">
                            <Badge variant={STATUS_VARIANT[r.status]} title={r.error ?? undefined}>
                              {t(`comments.activity.status.${r.status}`)}
                            </Badge>
                            {r.error && <p className="mt-1 max-w-xs text-xs text-destructive">{r.error}</p>}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {r.conversation_id && (
                              <Link href={`/inbox?c=${r.conversation_id}`} className="text-primary underline-offset-2 hover:underline">
                                {t("comments.activity.open")}
                              </Link>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      <Dialog open={!!draft} onOpenChange={(v) => !v && setDraft(null)}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft?.id ? t("comments.form.titleEdit") : t("comments.form.titleNew")}</DialogTitle>
            <DialogDescription>{t("comments.form.onePerPerson")}</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="cr-name">{t("comments.form.name")}</Label>
                <Input id="cr-name" value={draft.name} maxLength={80} placeholder={t("comments.form.namePlaceholder")} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="cr-account">{t("comments.form.account")}</Label>
                  <select
                    id="cr-account"
                    className={cn(selectClass, "w-full")}
                    value={draft.channel_id}
                    onChange={(e) => {
                      setPosts({ state: "idle", list: [] });
                      setDraft({ ...draft, channel_id: e.target.value, post_id: null, post_label: null });
                    }}
                  >
                    <option value="">{t("comments.allAccounts")}</option>
                    {data.channels.map((c) => (
                      <option key={c.id} value={c.id}>
                        {channelLabel(c)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cr-post">{t("comments.form.post")}</Label>
                  <select
                    id="cr-post"
                    className={cn(selectClass, "w-full")}
                    value={draft.post_id ? "one" : "all"}
                    disabled={!draft.channel_id}
                    onChange={(e) => {
                      if (e.target.value === "all") setDraft({ ...draft, post_id: null, post_label: null });
                      else void loadPosts(draft.channel_id);
                    }}
                  >
                    <option value="all">{t("comments.form.postAll")}</option>
                    <option value="one">{t("comments.form.postOne")}</option>
                  </select>
                </div>
              </div>
              {!draft.channel_id && <p className="-mt-2 text-xs text-muted-foreground">{t("comments.form.pickAccountFirst")}</p>}

              {draft.post_id && posts.state === "idle" && (
                <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                  <span className="truncate">“{draft.post_label || draft.post_id}”</span>
                  <Button size="sm" variant="outline" onClick={() => loadPosts(draft.channel_id)}>
                    {t("comments.form.changePost")}
                  </Button>
                </div>
              )}
              {posts.state === "loading" && <p className="text-sm text-muted-foreground">{t("comments.form.loadingPosts")}</p>}
              {posts.state === "error" && <p className="text-sm text-destructive">{posts.error}</p>}
              {posts.state === "ready" &&
                (posts.list.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("comments.form.noPosts")}</p>
                ) : (
                  <ul className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4" aria-label={t("comments.form.pickPost")}>
                    {posts.list.map((p) => {
                      const label = p.text.replace(/\s+/g, " ").slice(0, 80) || p.id;
                      const selected = draft.post_id === p.id;
                      return (
                        <li key={p.id}>
                          <button
                            type="button"
                            aria-pressed={selected}
                            onClick={() => {
                              setDraft({ ...draft, post_id: p.id, post_label: label });
                              setPosts({ state: "idle", list: [] });
                            }}
                            className={cn(
                              "flex w-full flex-col overflow-hidden rounded-md border text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              selected ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/60",
                            )}
                          >
                            {p.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element -- Meta CDN URLs, short-lived
                              <img src={p.imageUrl} alt="" className="aspect-square w-full object-cover" />
                            ) : (
                              <span className="flex aspect-square w-full items-center justify-center bg-muted text-muted-foreground">
                                <ImageOff className="h-5 w-5" aria-hidden />
                              </span>
                            )}
                            <span className="line-clamp-2 p-1.5">{label}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ))}

              <div className="space-y-1.5">
                <Label htmlFor="cr-keywords">{t("comments.form.keywords")}</Label>
                <Input id="cr-keywords" value={draft.keywords} placeholder={t("comments.form.keywordsPlaceholder")} onChange={(e) => setDraft({ ...draft, keywords: e.target.value })} aria-describedby="cr-keywords-help" />
                <p id="cr-keywords-help" className="text-xs text-muted-foreground">{t("comments.form.keywordsHelp")}</p>
              </div>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">{t("comments.form.public")}</legend>
                <p className="text-xs text-muted-foreground">{t("comments.form.publicHelp")}</p>
                {draft.public_replies.map((reply, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <Textarea
                      rows={2}
                      value={reply}
                      maxLength={2200}
                      placeholder={t("comments.form.publicPlaceholder")}
                      aria-label={`${t("comments.form.public")} ${i + 1}`}
                      onChange={(e) => setDraft({ ...draft, public_replies: draft.public_replies.map((r, j) => (j === i ? e.target.value : r)) })}
                    />
                    {draft.public_replies.length > 1 && (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`${t("comments.form.removePublic")} ${i + 1}`}
                        onClick={() => setDraft({ ...draft, public_replies: draft.public_replies.filter((_, j) => j !== i) })}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    )}
                  </div>
                ))}
                {draft.public_replies.length < 10 && (
                  <Button size="sm" variant="outline" onClick={() => setDraft({ ...draft, public_replies: [...draft.public_replies, ""] })}>
                    <Plus className="h-3.5 w-3.5" aria-hidden /> {t("comments.form.addPublic")}
                  </Button>
                )}
              </fieldset>

              <div className="space-y-1.5">
                <Label htmlFor="cr-private">{t("comments.form.private")}</Label>
                <Textarea id="cr-private" rows={4} maxLength={2000} value={draft.private_message} placeholder={t("comments.form.privatePlaceholder")} onChange={(e) => setDraft({ ...draft, private_message: e.target.value })} aria-describedby="cr-private-help" />
                <p id="cr-private-help" className="text-xs text-muted-foreground">{t("comments.form.privateHelp")}</p>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <Switch checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} />
                {t("comments.enabled")}
              </label>

              {formError && (
                <p role="alert" className="text-sm text-destructive">
                  {formError}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              {t("comments.cancel")}
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} {t("comments.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        isOpen={!!toDelete}
        onOpenChange={(v) => !v && setToDelete(null)}
        title={t("comments.deleteTitle")}
        description={t("comments.deleteBody")}
        confirmText={t("comments.delete")}
        cancelText={t("comments.cancel")}
        variant="destructive"
        onConfirm={remove}
      />
    </div>
  );
}

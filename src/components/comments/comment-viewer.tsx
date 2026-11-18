"use client";

import { useState } from "react";
import { toast } from "sonner";
import { EyeOff, Eye, ExternalLink, ImageOff, Loader2, MessageSquareReply, RefreshCw } from "lucide-react";
import { useT } from "@/i18n/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CHANNEL_STYLE, selectClass } from "@/components/channels/channel-types";
import { cn } from "@/lib/utils";
import type { Thread, ThreadComment, ThreadReply } from "@/lib/comments/thread";

export interface ViewerChannel {
  id: string;
  type: "instagram" | "messenger" | "tiktok";
  name: string;
  display_handle: string | null;
}

interface Post {
  id: string;
  text: string;
  imageUrl: string | null;
  permalink: string | null;
}

const REPLY_MAX = { instagram: 2200, messenger: 8000, tiktok: 1200 } as const;

function networkName(type: ViewerChannel["type"]) {
  return type === "instagram" ? "Instagram" : type === "tiktok" ? "TikTok" : "Facebook";
}

function when(iso: string | null, locale: string) {
  if (!iso) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

const postLabel = (p: Post) => p.text.replace(/\s+/g, " ").slice(0, 80) || p.id;

/**
 * Reads the comments of one post live from Facebook, Instagram or TikTok and
 * lets the business reply as its account or hide them; each comment shows
 * its state (unanswered / replied / hidden), which changes in place.
 */
export function CommentViewer({ channels, locale }: { channels: ViewerChannel[]; locale: string }) {
  const t = useT();
  const [channelId, setChannelId] = useState(channels.length === 1 ? channels[0].id : "");
  const [posts, setPosts] = useState<{ state: "idle" | "loading" | "ready" | "error"; list: Post[]; error?: string }>({ state: "idle", list: [] });
  const [post, setPost] = useState<Post | null>(null);
  const [thread, setThread] = useState<{ state: "idle" | "loading" | "ready" | "error"; data?: Thread; error?: string }>({ state: "idle" });
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const channel = channels.find((c) => c.id === channelId);
  const network = channel ? networkName(channel.type) : "";
  const errorText = (body: { error?: string }) => (body.error === "reconnect" ? t("comments.viewer.reconnect") : t("comments.viewer.error"));

  const loadPosts = async (id: string) => {
    setPosts({ state: "loading", list: [] });
    const res = await fetch(`/api/comment-rules/posts?channel_id=${id}`, { cache: "no-store" }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (res?.ok) setPosts({ state: "ready", list: body.posts ?? [] });
    else setPosts({ state: "error", list: [], error: body.error === "reconnect" ? t("comments.viewer.reconnect") : t("comments.form.postsError") });
  };

  const loadThread = async (id: string, p: Post) => {
    setThread({ state: "loading" });
    setReplyingTo(null);
    const res = await fetch(`/api/comment-rules/comments?${new URLSearchParams({ channel_id: id, post_id: p.id })}`, { cache: "no-store" }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (res?.ok) setThread({ state: "ready", data: body as Thread });
    else setThread({ state: "error", error: errorText(body) });
  };

  const pickChannel = (id: string) => {
    setChannelId(id);
    setPost(null);
    setThread({ state: "idle" });
    setPosts({ state: "idle", list: [] });
    if (id) void loadPosts(id);
  };

  const pickPost = (p: Post) => {
    setPost(p);
    setPosts((s) => ({ ...s, state: "idle" }));
    void loadThread(channelId, p);
  };

  const updateComment = (id: string, change: (c: ThreadComment) => ThreadComment) =>
    setThread((s) => (s.data ? { ...s, data: { ...s.data, comments: s.data.comments.map((c) => (c.id === id ? change(c) : c)) } } : s));

  const act = async (c: ThreadComment, action: "reply" | "hide" | "unhide") => {
    if (!post || !channel) return;
    setBusy(`${action}:${c.id}`);
    const res = await fetch("/api/comment-rules/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel_id: channel.id, post_id: post.id, comment_id: c.id, action, text: action === "reply" ? draft : undefined }),
    }).catch(() => null);
    setBusy(null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) {
      toast.error(body.error === "too_long" ? t("comments.viewer.tooLong", { max: body.max }) : body.error === "reconnect" ? t("comments.viewer.reconnect") : t("comments.viewer.failed"));
      return;
    }
    if (action === "reply") {
      const reply = { ...(body.reply as ThreadReply), author: thread.data?.account.name ?? (body.reply as ThreadReply).author };
      updateComment(c.id, (x) => ({ ...x, replies: [...x.replies, reply], replied: true }));
      setReplyingTo(null);
      setDraft("");
      toast.success(t("comments.viewer.replied"));
    } else {
      updateComment(c.id, (x) => ({ ...x, hidden: action === "hide" }));
      toast.success(t(action === "hide" ? "comments.viewer.hiddenOk" : "comments.viewer.shownOk"));
    }
  };

  const Icon = channel ? CHANNEL_STYLE[channel.type].icon : MessageSquareReply;
  const account = thread.data?.account;

  return (
    <section aria-labelledby="comment-viewer" className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div>
        <h2 id="comment-viewer" className="text-sm font-semibold text-foreground">
          {t("comments.viewer.title")}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("comments.viewer.subtitle")}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 space-y-1.5">
          <Label htmlFor="cv-account">{t("comments.viewer.account")}</Label>
          <select id="cv-account" className={cn(selectClass, "w-full")} value={channelId} onChange={(e) => pickChannel(e.target.value)}>
            <option value="">{t("comments.viewer.pickAccount")}</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {networkName(c.type)} · {c.display_handle ? `@${c.display_handle.replace(/^@/, "")}` : c.name}
              </option>
            ))}
          </select>
        </div>
        {channelId && (
          <Button variant="outline" onClick={() => loadPosts(channelId)} disabled={posts.state === "loading"}>
            {post ? t("comments.viewer.changePost") : t("comments.viewer.choosePost")}
          </Button>
        )}
      </div>

      {posts.state === "loading" && <p className="text-sm text-muted-foreground">{t("comments.form.loadingPosts")}</p>}
      {posts.state === "error" && <p className="text-sm text-destructive">{posts.error}</p>}
      {posts.state === "ready" &&
        (posts.list.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("comments.form.noPosts")}</p>
        ) : (
          <ul className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-6" aria-label={t("comments.viewer.choosePost")}>
            {posts.list.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  aria-pressed={post?.id === p.id}
                  onClick={() => pickPost(p)}
                  className={cn(
                    "flex w-full flex-col overflow-hidden rounded-md border text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    post?.id === p.id ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/60",
                  )}
                >
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- network CDN URLs, short-lived
                    <img src={p.imageUrl} alt="" className="aspect-square w-full object-cover" />
                  ) : (
                    <span className="flex aspect-square w-full items-center justify-center bg-muted text-muted-foreground">
                      <ImageOff className="h-5 w-5" aria-hidden />
                    </span>
                  )}
                  <span className="line-clamp-2 p-1.5">{postLabel(p)}</span>
                </button>
              </li>
            ))}
          </ul>
        ))}

      {post && channel && (
        <div className="space-y-3 border-t border-border pt-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              {account?.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element -- network CDN URL
                <img src={account.avatar} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
              ) : (
                <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", CHANNEL_STYLE[channel.type].tile)}>
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
              )}
              <div className="min-w-0 text-sm">
                <p className="text-xs text-muted-foreground">{t("comments.viewer.showingFor", { network })}</p>
                <p className="truncate font-semibold text-foreground">
                  {account?.name ?? channel.name}
                  {account?.handle && <span className="ml-1 font-normal text-muted-foreground">@{account.handle}</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {t("comments.viewer.post")}: “{postLabel(post)}”
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {post.permalink && (
                <a href={post.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline">
                  {t("comments.viewer.openPost", { network })} <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              )}
              <Button size="sm" variant="outline" onClick={() => loadThread(channel.id, post)} disabled={thread.state === "loading"}>
                <RefreshCw className={cn("h-3.5 w-3.5", thread.state === "loading" && "animate-spin")} aria-hidden /> {t("comments.viewer.refresh")}
              </Button>
            </div>
          </div>

          {thread.state === "loading" && !thread.data && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t("comments.viewer.loading")}
            </p>
          )}
          {thread.state === "error" && <p className="text-sm text-destructive">{thread.error}</p>}
          {thread.data &&
            (thread.data.comments.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("comments.viewer.empty")}</p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  {t("comments.viewer.count", { count: thread.data.comments.length })}
                </p>
                <ul className="space-y-2">
                  {thread.data.comments.map((c) => (
                    <li key={c.id} className={cn("rounded-lg border border-border p-3", c.hidden && "bg-muted/40")}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm">
                            <span className="font-medium text-foreground">{c.fromAccount ? `${c.author} · ${t("comments.viewer.you")}` : c.author}</span>
                            <span className="ml-2 text-xs text-muted-foreground">{when(c.createdAt, locale)}</span>
                          </p>
                          <p className={cn("mt-0.5 whitespace-pre-wrap break-words text-sm", c.hidden ? "text-muted-foreground" : "text-foreground")}>{c.text}</p>
                          {c.hidden && <p className="mt-0.5 text-xs text-muted-foreground">{t("comments.viewer.hiddenHint")}</p>}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {c.hidden && <Badge variant="secondary">{t("comments.viewer.status.hidden")}</Badge>}
                          {!c.fromAccount &&
                            (c.replied ? (
                              <Badge>{t("comments.viewer.status.replied")}</Badge>
                            ) : (
                              <Badge variant="outline" className="border-amber-500/60 text-amber-700 dark:text-amber-400">
                                {t("comments.viewer.status.unanswered")}
                              </Badge>
                            ))}
                        </div>
                      </div>

                      {c.replies.length > 0 && (
                        <ul className="mt-2 space-y-1.5 border-l-2 border-border pl-3">
                          {c.replies.map((r) => (
                            <li key={r.id} className="text-sm">
                              <span className={cn("font-medium", r.fromAccount ? "text-primary" : "text-foreground")}>
                                {r.fromAccount ? `${r.author} · ${t("comments.viewer.you")}` : r.author}
                              </span>
                              <span className="ml-2 text-xs text-muted-foreground">{when(r.createdAt, locale)}</span>
                              <p className="whitespace-pre-wrap break-words text-foreground">{r.text}</p>
                            </li>
                          ))}
                        </ul>
                      )}

                      {!c.fromAccount && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-expanded={replyingTo === c.id}
                            onClick={() => {
                              setReplyingTo(replyingTo === c.id ? null : c.id);
                              setDraft("");
                            }}
                          >
                            <MessageSquareReply className="h-3.5 w-3.5" aria-hidden /> {t("comments.viewer.reply")}
                          </Button>
                          {c.canHide && (
                            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => act(c, c.hidden ? "unhide" : "hide")}>
                              {busy === `${c.hidden ? "unhide" : "hide"}:${c.id}` ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                              ) : c.hidden ? (
                                <Eye className="h-3.5 w-3.5" aria-hidden />
                              ) : (
                                <EyeOff className="h-3.5 w-3.5" aria-hidden />
                              )}{" "}
                              {t(c.hidden ? "comments.viewer.unhide" : "comments.viewer.hide")}
                            </Button>
                          )}
                        </div>
                      )}

                      {replyingTo === c.id && (
                        <div className="mt-2 space-y-2">
                          <Label htmlFor={`cv-reply-${c.id}`} className="text-xs">
                            {t("comments.viewer.replyAs", { name: account?.name ?? channel.name })}
                          </Label>
                          <Textarea
                            id={`cv-reply-${c.id}`}
                            rows={2}
                            value={draft}
                            maxLength={REPLY_MAX[channel.type]}
                            placeholder={t("comments.viewer.replyPlaceholder")}
                            onChange={(e) => setDraft(e.target.value)}
                          />
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="outline" onClick={() => setReplyingTo(null)}>
                              {t("comments.cancel")}
                            </Button>
                            <Button size="sm" disabled={!draft.trim() || busy !== null} onClick={() => act(c, "reply")}>
                              {busy === `reply:${c.id}` && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} {t("comments.viewer.send")}
                            </Button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ))}
        </div>
      )}
    </section>
  );
}

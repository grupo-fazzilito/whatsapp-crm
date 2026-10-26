"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { BookOpen, Terminal } from "lucide-react";
import { useI18n, useLocalePath } from "@/i18n/client";
import { cn } from "@/lib/utils";
import {
  API_BASE_PATH,
  API_ERROR_DOCS,
  API_RESOURCES,
  API_SCOPE_DOCS,
  WEBHOOK_ENVELOPE,
  WEBHOOK_EVENT_DOCS,
  WEBHOOK_VERIFY_NODE,
  type DocEndpoint,
  type DocParam,
} from "@/lib/public-api/docs";

const BASE_URL = `https://whasalia.com${API_BASE_PATH}`;

const METHOD_CLS: Record<DocEndpoint["method"], string> = {
  GET: "border-sky-500/30 bg-sky-500/10 text-sky-400 [[data-mtheme=light]_&]:text-sky-700",
  POST: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 [[data-mtheme=light]_&]:text-emerald-700",
  PATCH: "border-amber-500/30 bg-amber-500/10 text-amber-400 [[data-mtheme=light]_&]:text-amber-800",
  DELETE: "border-red-500/30 bg-red-500/10 text-red-400 [[data-mtheme=light]_&]:text-red-700",
};

/** `code` and **bold** inside a text. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("**") ? (
          <strong key={i} className="font-semibold text-[var(--m-text-heading)]">
            {part.slice(2, -2)}
          </strong>
        ) : part.startsWith("`") && part.endsWith("`") ? (
          <code key={i} className="rounded bg-[var(--m-bg-secondary)] px-1 py-0.5 font-mono text-[0.85em] text-[var(--m-text-heading)]">
            {part.slice(1, -1)}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-[var(--m-border-primary)] bg-[var(--m-bg-secondary)]/60 p-4 font-mono text-xs leading-relaxed text-[var(--m-text-secondary)]">
      {children}
    </pre>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28 space-y-4 border-t border-[var(--m-border-primary)] pt-10">
      <h2 className="text-2xl font-bold tracking-tight text-[var(--m-text-heading)]">{title}</h2>
      {children}
    </section>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-[var(--m-text-secondary)]">{children}</p>;
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--m-border-primary)]">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead className="bg-[var(--m-bg-secondary)]/60 text-xs uppercase tracking-wide text-[var(--m-text-muted)]">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--m-border-primary)] text-[var(--m-text-secondary)]">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, k) => (
                <td key={k} className="px-3 py-2 align-top">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Public API reference: authentication, scopes, errors, every /api/v1 endpoint and the webhooks. */
export default function ApiDocsPage() {
  const { t, locale } = useI18n();
  const lp = useLocalePath();
  const lang = locale === "en" ? "en" : "es";

  const params = (list: DocParam[], title: string) => (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--m-text-muted)]">{title}</h4>
      <Table
        head={[t("mktApiDocs.col.field"), t("mktApiDocs.col.type"), t("mktApiDocs.col.description")]}
        rows={list.map((p) => [
          <span key="n" className="font-mono text-xs text-[var(--m-text-heading)]">
            {p.name}
            {p.required && <span className="ml-1 text-red-500" title={t("mktApiDocs.required")}>*</span>}
          </span>,
          <span key="t" className="font-mono text-xs">{p.type}</span>,
          <Rich key="d" text={p.desc[lang]} />,
        ])}
      />
    </div>
  );

  const toc = [
    { id: "intro", label: t("mktApiDocs.toc.intro") },
    { id: "auth", label: t("mktApiDocs.toc.auth") },
    { id: "scopes", label: t("mktApiDocs.toc.scopes") },
    { id: "errors", label: t("mktApiDocs.toc.errors") },
    { id: "pagination", label: t("mktApiDocs.toc.pagination") },
    { id: "limits", label: t("mktApiDocs.toc.limits") },
    ...API_RESOURCES.map((r) => ({ id: r.id, label: r.title[lang] })),
    { id: "webhooks", label: t("mktApiDocs.toc.webhooks") },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-16 md:px-6 md:py-20">
      <header className="max-w-3xl space-y-4">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-[var(--m-badge-bg)] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-500">
          <Terminal className="size-3.5" aria-hidden /> {t("mktApiDocs.badge")}
        </div>
        <h1 className="text-4xl font-extrabold leading-[1.1] tracking-tight text-[var(--m-text-heading)] sm:text-5xl">{t("mktApiDocs.title")}</h1>
        <p className="text-base leading-relaxed text-[var(--m-text-tertiary)]">{t("mktApiDocs.subtitle")}</p>
      </header>

      <div className="mt-12 grid gap-10 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label={t("mktApiDocs.tocLabel")} className="lg:sticky lg:top-28 lg:self-start">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--m-text-muted)]">
            <BookOpen className="size-3.5" aria-hidden /> {t("mktApiDocs.tocLabel")}
          </p>
          <ol className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm lg:flex-col">
            {toc.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-[var(--m-text-tertiary)] hover:text-emerald-500 [[data-mtheme=light]_&]:hover:text-emerald-700">
                  {s.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-w-0 space-y-10">
          <section id="intro" className="scroll-mt-28 space-y-4">
            <h2 className="text-2xl font-bold tracking-tight text-[var(--m-text-heading)]">{t("mktApiDocs.toc.intro")}</h2>
            <P>
              <Rich text={t("mktApiDocs.intro.body")} />
            </P>
            <Code>{BASE_URL}</Code>
            <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--m-text-secondary)]">
              {(["json", "ids", "dates", "scope"] as const).map((k) => (
                <li key={k}>
                  <Rich text={t(`mktApiDocs.intro.${k}`)} />
                </li>
              ))}
            </ul>
          </section>

          <Section id="auth" title={t("mktApiDocs.toc.auth")}>
            <P>
              <Rich text={t("mktApiDocs.auth.body")} />
            </P>
            <Code>{`curl ${BASE_URL}/me \\\n  -H "Authorization: Bearer $WHASALIA_API_KEY"`}</Code>
            <P>
              <Rich text={t("mktApiDocs.auth.safety")} />
            </P>
          </Section>

          <Section id="scopes" title={t("mktApiDocs.toc.scopes")}>
            <P>
              <Rich text={t("mktApiDocs.scopes.body")} />
            </P>
            <Table
              head={[t("mktApiDocs.col.scope"), t("mktApiDocs.col.access")]}
              rows={API_SCOPE_DOCS.map((s) => [
                <code key="s" className="font-mono text-xs text-[var(--m-text-heading)]">{s.scope}</code>,
                s.desc[lang],
              ])}
            />
          </Section>

          <Section id="errors" title={t("mktApiDocs.toc.errors")}>
            <P>
              <Rich text={t("mktApiDocs.errors.body")} />
            </P>
            <Code>{`{ "error": { "code": "insufficient_scope", "message": "This API key lacks the required scope (orders | write)." } }`}</Code>
            <Table
              head={["HTTP", t("mktApiDocs.col.code"), t("mktApiDocs.col.description")]}
              rows={API_ERROR_DOCS.map((e) => [
                <span key="s" className="font-mono text-xs">{e.status}</span>,
                <span key="c" className="font-mono text-xs">{e.codes}</span>,
                <Rich key="d" text={e.desc[lang]} />,
              ])}
            />
          </Section>

          <Section id="pagination" title={t("mktApiDocs.toc.pagination")}>
            <P>
              <Rich text={t("mktApiDocs.pagination.body")} />
            </P>
            <Code>{`curl "${BASE_URL}/contacts?limit=100&cursor=WyIyMDI2LTEwLTIw…" \\\n  -H "Authorization: Bearer $WHASALIA_API_KEY"`}</Code>
          </Section>

          <Section id="limits" title={t("mktApiDocs.toc.limits")}>
            <P>
              <Rich text={t("mktApiDocs.limits.body")} />
            </P>
          </Section>

          {API_RESOURCES.map((r) => (
            <Section key={r.id} id={r.id} title={r.title[lang]}>
              {r.intro && (
                <P>
                  <Rich text={r.intro[lang]} />
                </P>
              )}
              <div className="space-y-8">
                {r.endpoints.map((e) => (
                  <article key={e.id} id={e.id} className="scroll-mt-28 space-y-3 rounded-2xl border border-[var(--m-border-primary)] bg-[var(--m-bg-glass)] p-4 sm:p-5">
                    <h3 className="flex flex-wrap items-center gap-2">
                      <span className={cn("rounded-md border px-2 py-0.5 font-mono text-[11px] font-bold", METHOD_CLS[e.method])}>{e.method}</span>
                      <code className="break-all font-mono text-sm font-semibold text-[var(--m-text-heading)]">{e.path}</code>
                      {e.scope && (
                        <span className="ml-auto rounded-full border border-[var(--m-border-primary)] px-2 py-0.5 font-mono text-[11px] text-[var(--m-text-muted)]">
                          {e.scope}
                        </span>
                      )}
                    </h3>
                    <P>
                      <Rich text={e.summary[lang]} />
                    </P>
                    {e.query && params(e.query, t("mktApiDocs.query"))}
                    {e.body && params(e.body, t("mktApiDocs.body"))}
                    {e.example && <Code>{e.example}</Code>}
                  </article>
                ))}
              </div>
            </Section>
          ))}

          <Section id="webhooks" title={t("mktApiDocs.toc.webhooks")}>
            <P>
              <Rich text={t("mktApiDocs.webhooks.body")} />
            </P>
            <Code>{WEBHOOK_ENVELOPE}</Code>
            <h3 className="text-lg font-semibold text-[var(--m-text-heading)]">{t("mktApiDocs.webhooks.verifyTitle")}</h3>
            <P>
              <Rich text={t("mktApiDocs.webhooks.verifyBody")} />
            </P>
            <Code>{WEBHOOK_VERIFY_NODE}</Code>
            <h3 className="text-lg font-semibold text-[var(--m-text-heading)]">{t("mktApiDocs.webhooks.retriesTitle")}</h3>
            <P>
              <Rich text={t("mktApiDocs.webhooks.retriesBody")} />
            </P>
            <h3 className="text-lg font-semibold text-[var(--m-text-heading)]">{t("mktApiDocs.webhooks.eventsTitle")}</h3>
            <P>
              <Rich text={t("mktApiDocs.webhooks.eventsBody")} />
            </P>
            <Table
              head={[t("mktApiDocs.col.event"), "data", t("mktApiDocs.col.description")]}
              rows={WEBHOOK_EVENT_DOCS.map((e) => [
                <code key="t" className="font-mono text-xs text-[var(--m-text-heading)]">{e.type}</code>,
                <span key="d" className="font-mono text-xs">{e.data}</span>,
                <Rich key="x" text={e.desc[lang]} />,
              ])}
            />
          </Section>

          <p className="border-t border-[var(--m-border-primary)] pt-8 text-sm text-[var(--m-text-tertiary)]">
            {t("mktApiDocs.help")}{" "}
            <Link href={lp("/contact-us")} className="font-medium text-emerald-500 [[data-mtheme=light]_&]:text-emerald-700 hover:underline">
              {t("mktApiDocs.helpLink")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

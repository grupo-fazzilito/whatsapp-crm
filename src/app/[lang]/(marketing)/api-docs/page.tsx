"use client";

import React, { useState } from "react";
import { Terminal, Sparkles, Send, ArrowRight } from "lucide-react";
import { SpotlightCard } from "@/components/marketing/spotlight-card";
import { useI18n } from "@/i18n/client";

export default function APIDocsLanding() {
  const { t } = useI18n();
  const [lang, setLang] = useState<"curl" | "node" | "python">("curl");

  const codes = {
    curl: `curl -X POST https://api.whasalia.com/v1/messages \\
  -H "Authorization: Bearer cnx_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "+15550199",
    "template_name": "welcome_alert",
    "language": "en",
    "components": [
      {
        "type": "body",
        "parameters": [
          { "type": "text", "text": "Acme Partner" }
        ]
      }
    ]
  }'`,
    node: `const client = require('@whasalia/sdk')('cnx_live_...');

await client.messages.sendTemplate({
  to: '+15550199',
  templateName: 'welcome_alert',
  languageCode: 'en',
  bodyParameters: ['Acme Partner']
});`,
    python: `import whasalia

client = whasalia.Client(api_key='cnx_live_...')

client.messages.send_template(
    to='+15550199',
    template_name='welcome_alert',
    language_code='en',
    body_parameters=['Acme Partner']
)`,
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-4 md:px-6 py-20 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
      {/* Documentation Info column */}
      <div className="space-y-6">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-emerald-950/20 text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
          <Terminal className="size-3.5" /> {t("mktApiDocs.badge")}
        </div>
        <h1 className="text-4xl sm:text-6xl font-extrabold text-[var(--m-text-heading)] tracking-tight leading-[1.08]">
          {t("mktApiDocs.titleLine1")} <br />
          <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
            {t("mktApiDocs.titleHighlight")}
          </span>
        </h1>
        <p className="text-sm text-[var(--m-text-tertiary)] leading-relaxed">
          {t("mktApiDocs.subtitle")}
        </p>

        {/* Bullet details */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <div className="flex gap-2">
            <span className="text-emerald-500 font-bold font-mono">✓</span>
            <div>
              <h4 className="text-xs font-bold text-[var(--m-text-secondary)]">{t("mktApiDocs.authTitle")}</h4>
              <p className="text-[10px] text-[var(--m-text-tertiary)] mt-0.5">{t("mktApiDocs.authDesc")}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <span className="text-emerald-500 font-bold font-mono">✓</span>
            <div>
              <h4 className="text-xs font-bold text-[var(--m-text-secondary)]">{t("mktApiDocs.webhookTitle")}</h4>
              <p className="text-[10px] text-[var(--m-text-tertiary)] mt-0.5">{t("mktApiDocs.webhookDesc")}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Terminal IDE Code Block column */}
      <div className="relative">
        <div className="absolute inset-0 bg-emerald-500/5 blur-[95px] pointer-events-none" />
        
        <div className="rounded-2xl border border-[var(--m-border-primary)] bg-[var(--m-bg-primary)] p-4 shadow-2xl relative z-10 flex flex-col h-[380px] justify-between">
          {/* Header IDE controls */}
          <div className="flex items-center justify-between border-b border-[var(--m-border-primary)] pb-3 mb-3">
            <div className="flex gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[var(--m-bg-tertiary)]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[var(--m-bg-secondary)]" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/30" />
            </div>

            {/* Lang switch tabs */}
            <div className="flex gap-2">
              {(["curl", "node", "python"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={`text-[9px] font-bold px-2 py-0.5 rounded cursor-pointer uppercase ${
                    lang === l ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400" : "text-[var(--m-text-muted)]"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Code text */}
          <div className="flex-1 bg-[var(--m-bg-secondary)]/40 border border-[var(--m-border-glass)]/80 rounded-lg p-4 font-mono text-[11px] text-[var(--m-text-secondary)] leading-relaxed overflow-x-auto whitespace-pre">
            {codes[lang]}
          </div>

          {/* Footer stats */}
          <div className="flex items-center justify-between border-t border-[var(--m-border-primary)] pt-4 mt-3">
            <span className="text-[9px] text-[var(--m-text-muted)]">{t("mktApiDocs.footerStatus")}</span>
            <span className="text-[9px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded px-1.5 py-0.5 font-bold">{t("mktApiDocs.apiActive")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

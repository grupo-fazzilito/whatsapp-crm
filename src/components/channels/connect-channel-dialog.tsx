'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, ExternalLink, Info, Loader2 } from 'lucide-react';
import { useT } from '@/i18n/client';
import type { ChannelType } from '@/lib/channels/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  CHANNEL_ORDER,
  CHANNEL_STYLE,
  apiJson,
  selectClass,
  widgetSnippet,
  type AgentOption,
  type ChannelDTO,
  type ChannelFeatures,
} from './channel-types';
import { CopyField } from './copy-field';
import { WhatsAppSignup } from './whatsapp-signup';
import {
  DEFAULT_WEBCHAT_FORM,
  WebchatSettingsFields,
  webchatSettingsPayload,
  type WebchatForm,
} from './webchat-settings-fields';

type Step = { kind: 'pick' } | { kind: 'form'; type: ChannelType } | { kind: 'done'; channel: ChannelDTO; verifyToken?: string };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  features: ChannelFeatures;
  agents: AgentOption[];
  onCreated: () => void;
}

export const PURPOSE_SUGGESTIONS = ['attention', 'sales', 'marketing', 'support'] as const;

export function ConnectChannelDialog({ open, onOpenChange, features, agents, onCreated }: Props) {
  const t = useT();
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const [saving, setSaving] = useState(false);
  const [manualMeta, setManualMeta] = useState(false);

  // Shared fields
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [agentId, setAgentId] = useState('');
  // Provider fields
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [pageId, setPageId] = useState('');
  const [instagramId, setInstagramId] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [webchat, setWebchat] = useState<WebchatForm>(DEFAULT_WEBCHAT_FORM);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const webhookUrl = `${origin}/api/webhooks/meta`;

  const reset = () => {
    setStep({ kind: 'pick' });
    setManualMeta(false);
    setName('');
    setPurpose('');
    setAgentId('');
    setPhoneNumberId('');
    setWabaId('');
    setAccessToken('');
    setVerifyToken('');
    setAppSecret('');
    setPageId('');
    setInstagramId('');
    setBusinessId('');
    setWebchat(DEFAULT_WEBCHAT_FORM);
  };

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) setTimeout(reset, 200);
  };

  const pick = (type: ChannelType) => {
    if (type === 'tiktok' && !features.tiktok) return;
    setName(type === 'webchat' ? t('channels.webchat.defaultName') : CHANNEL_STYLE[type].label);
    // The direct "connect" button always comes first; manual setup is an advanced link.
    setManualMeta(false);
    setStep({ kind: 'form', type });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step.kind !== 'form') return;
    const type = step.type;
    const body: Record<string, unknown> = { type, name, purpose: purpose || null, ai_agent_id: agentId || null };
    if (type === 'whatsapp') Object.assign(body, { phone_number_id: phoneNumberId, waba_id: wabaId || null, access_token: accessToken, verify_token: verifyToken || null, app_secret: appSecret || null });
    if (type === 'messenger') Object.assign(body, { page_id: pageId, access_token: accessToken, app_secret: appSecret || null });
    if (type === 'instagram') Object.assign(body, { instagram_id: instagramId, page_id: pageId, access_token: accessToken, app_secret: appSecret || null });
    if (type === 'tiktok') Object.assign(body, { business_id: businessId, access_token: accessToken });
    if (type === 'webchat') body.settings = webchatSettingsPayload({ ...webchat, title: webchat.title || name });

    setSaving(true);
    try {
      const data = await apiJson<{ channel: ChannelDTO; verify_token?: string }>('/api/channels', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      toast.success(t('channels.connected', { name: data.channel.name }));
      onCreated();
      if (type === 'whatsapp' || type === 'webchat') {
        setStep({ kind: 'done', channel: data.channel, verifyToken: data.verify_token });
      } else {
        close(false);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const type = step.kind === 'form' ? step.type : null;
  const isMeta = type === 'messenger' || type === 'instagram';

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {step.kind === 'pick' && (
          <>
            <DialogHeader>
              <DialogTitle>{t('channels.connect.title')}</DialogTitle>
              <DialogDescription>{t('channels.connect.description')}</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {CHANNEL_ORDER.map((ct) => {
                const s = CHANNEL_STYLE[ct];
                const disabled = ct === 'tiktok' && !features.tiktok;
                return (
                  <button
                    key={ct}
                    type="button"
                    disabled={disabled}
                    onClick={() => pick(ct)}
                    className={cn(
                      'flex items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors',
                      disabled ? 'cursor-not-allowed opacity-60' : 'hover:border-primary/50 hover:bg-accent',
                    )}
                  >
                    <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', s.tile)}>
                      <s.icon className="size-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">{t(`channels.type.${ct}`)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {disabled ? t('channels.tiktok.soon') : t(`channels.typeHint.${ct}`)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {step.kind === 'form' && type && (
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => setStep({ kind: 'pick' })} aria-label={t('channels.connect.back')}>
                  <ArrowLeft className="size-4" />
                </Button>
                {t('channels.connect.titleFor', { type: t(`channels.type.${type}`) })}
              </DialogTitle>
              <DialogDescription>{t(`channels.typeHint.${type}`)}</DialogDescription>
            </DialogHeader>

            {type === 'whatsapp' && !manualMeta ? (
              <WhatsAppSignup agents={agents} onCreated={onCreated} onManual={() => setManualMeta(true)} onDone={() => close(false)} />
            ) : isMeta && !manualMeta ? (
              <div className="grid gap-3">
                <p className="text-sm text-muted-foreground">{t('channels.meta.oauthIntro')}</p>
                {type === 'instagram' && <InstagramAccessNote />}
                <button
                  type="button"
                  disabled={!features.metaOAuth}
                  onClick={() => window.location.assign('/api/channels/meta/oauth/start')}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#1877F2] px-4 text-sm font-medium text-white hover:bg-[#166fe0] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ExternalLink className="size-4" />
                  {t('channels.meta.continueWithFacebook')}
                </button>
                {!features.metaOAuth && (
                  <p role="note" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                    {t('channels.meta.notEnabled')}
                  </p>
                )}
                <button type="button" className="text-xs text-muted-foreground underline underline-offset-2" onClick={() => setManualMeta(true)}>
                  {t('channels.meta.manualInstead')}
                </button>
              </div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id="ch-name" label={t('channels.form.name')}>
                    <Input id="ch-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
                  </Field>
                  <Field id="ch-purpose" label={t('channels.form.purpose')}>
                    <Input
                      id="ch-purpose"
                      list="ch-purpose-list"
                      maxLength={80}
                      value={purpose}
                      placeholder={t('channels.form.purposePlaceholder')}
                      onChange={(e) => setPurpose(e.target.value)}
                    />
                    <datalist id="ch-purpose-list">
                      {PURPOSE_SUGGESTIONS.map((p) => (
                        <option key={p} value={t(`channels.purposes.${p}`)} />
                      ))}
                    </datalist>
                  </Field>
                </div>

                {type === 'whatsapp' && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field id="ch-pnid" label={t('channels.whatsapp.phoneNumberId')}>
                        <Input id="ch-pnid" required inputMode="numeric" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value.trim())} />
                      </Field>
                      <Field id="ch-waba" label={t('channels.whatsapp.wabaId')} hint={t('channels.form.optional')}>
                        <Input id="ch-waba" inputMode="numeric" value={wabaId} onChange={(e) => setWabaId(e.target.value.trim())} />
                      </Field>
                    </div>
                    <Field id="ch-token" label={t('channels.form.accessToken')} hint={t('channels.whatsapp.tokenHelp')}>
                      <Input id="ch-token" required type="password" autoComplete="off" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
                    </Field>
                    <Field id="ch-vt" label={t('channels.whatsapp.verifyToken')} hint={t('channels.whatsapp.verifyTokenHelp')}>
                      <Input id="ch-vt" autoComplete="off" value={verifyToken} onChange={(e) => setVerifyToken(e.target.value)} />
                    </Field>
                    <AppSecretField value={appSecret} onChange={setAppSecret} />
                    <div className="grid gap-2 rounded-md border border-border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">{t('channels.whatsapp.webhookHelp')}</p>
                      <CopyField label={t('channels.webhookUrl')} value={webhookUrl} />
                    </div>
                    {features.whatsappSignup && (
                      <button type="button" className="justify-self-start text-xs text-muted-foreground underline underline-offset-2" onClick={() => setManualMeta(false)}>
                        {t('metawa.signup.useSignup')}
                      </button>
                    )}
                  </>
                )}

                {(type === 'messenger' || type === 'instagram') && (
                  <>
                    {type === 'instagram' && <InstagramAccessNote />}
                    {type === 'instagram' && (
                      <Field id="ch-ig" label={t('channels.meta.instagramId')}>
                        <Input id="ch-ig" required inputMode="numeric" value={instagramId} onChange={(e) => setInstagramId(e.target.value.trim())} />
                      </Field>
                    )}
                    <Field id="ch-page" label={t('channels.meta.pageId')} hint={type === 'instagram' ? t('channels.meta.pageIdForIg') : undefined}>
                      <Input id="ch-page" required inputMode="numeric" value={pageId} onChange={(e) => setPageId(e.target.value.trim())} />
                    </Field>
                    <Field id="ch-ptoken" label={t('channels.meta.pageToken')}>
                      <Input id="ch-ptoken" required type="password" autoComplete="off" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
                    </Field>
                    <AppSecretField value={appSecret} onChange={setAppSecret} />
                    <div className="grid gap-2 rounded-md border border-border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">{t('channels.meta.manualHelp')}</p>
                      <CopyField label={t('channels.webhookUrl')} value={webhookUrl} />
                    </div>
                    {features.metaOAuth && (
                      <button type="button" className="justify-self-start text-xs text-muted-foreground underline underline-offset-2" onClick={() => setManualMeta(false)}>
                        {t('channels.meta.useOauth')}
                      </button>
                    )}
                  </>
                )}

                {type === 'tiktok' && (
                  <>
                    <Field id="ch-tt" label={t('channels.tiktok.businessId')}>
                      <Input id="ch-tt" required value={businessId} onChange={(e) => setBusinessId(e.target.value.trim())} />
                    </Field>
                    <Field id="ch-ttok" label={t('channels.form.accessToken')}>
                      <Input id="ch-ttok" required type="password" autoComplete="off" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
                    </Field>
                  </>
                )}

                {type === 'webchat' && <WebchatSettingsFields value={webchat} onChange={setWebchat} />}

                <Field id="ch-agent" label={t('channels.form.agent')}>
                  <select id="ch-agent" className={selectClass} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                    <option value="">{t('channels.noAgent')}</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {a.enabled ? '' : ` (${t('channels.agentDisabled')})`}
                      </option>
                    ))}
                  </select>
                </Field>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => close(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving && <Loader2 className="size-4 animate-spin" />}
                    {t('channels.connect.submit')}
                  </Button>
                </DialogFooter>
              </>
            )}
          </form>
        )}

        {step.kind === 'done' && (
          <div className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t('channels.done.title', { name: step.channel.name })}</DialogTitle>
              <DialogDescription>
                {step.channel.type === 'webchat' ? t('channels.done.webchat') : t('channels.done.whatsapp')}
              </DialogDescription>
            </DialogHeader>
            {step.channel.type === 'webchat' ? (
              <CopyField multiline label={t('channels.webchat.snippet')} value={widgetSnippet(origin, step.channel.external_id)} />
            ) : (
              <div className="grid gap-3">
                <CopyField label={t('channels.webhookUrl')} value={webhookUrl} />
                {step.verifyToken && <CopyField label={t('channels.whatsapp.verifyToken')} value={step.verifyToken} />}
                <p className="text-xs text-muted-foreground">{t('channels.done.whatsappFields')}</p>
              </div>
            )}
            <DialogFooter>
              <Button type="button" onClick={() => close(false)}>
                {t('channels.done.close')}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Only for businesses using their own Meta app: verifies that app's webhook signatures. */
function AppSecretField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  return (
    <Field id="ch-appsecret" label={t('metawa.manual.appSecret')} hint={t('metawa.manual.appSecretHelp')}>
      <Input id="ch-appsecret" type="password" autoComplete="off" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value.trim())} />
    </Field>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Without this Instagram setting Meta never delivers DMs to any app. */
function InstagramAccessNote() {
  const t = useT();
  return (
    <div role="note" className="flex gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>{t('channels.meta.instagramAccess')}</p>
    </div>
  );
}

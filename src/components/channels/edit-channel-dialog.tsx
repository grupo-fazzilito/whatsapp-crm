'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useT } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { apiJson, widgetSnippet, type ChannelDTO } from './channel-types';
import { CopyField } from './copy-field';
import { WebchatSettingsFields, webchatFormFromSettings, webchatSettingsPayload, type WebchatForm } from './webchat-settings-fields';

interface Props {
  channel: ChannelDTO;
  origin: string;
  onClose: () => void;
  onSaved: () => void;
}

export function EditChannelDialog({ channel, origin, onClose, onSaved }: Props) {
  const t = useT();
  const [name, setName] = useState(channel.name);
  const [purpose, setPurpose] = useState(channel.purpose ?? '');
  const [accessToken, setAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [webchat, setWebchat] = useState<WebchatForm>(() => webchatFormFromSettings(channel.settings));
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = { name, purpose: purpose || null };
    if (channel.type === 'webchat') body.settings = webchatSettingsPayload(webchat);
    if (accessToken) body.access_token = accessToken;
    if (verifyToken) body.verify_token = verifyToken;
    setSaving(true);
    try {
      await apiJson(`/api/channels/${channel.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      toast.success(t('channels.saved'));
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t('channels.edit.title', { name: channel.name })}</DialogTitle>
            <DialogDescription>{t(`channels.type.${channel.type}`)}{channel.display_handle ? ` · ${channel.display_handle}` : ''}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ed-name">{t('channels.form.name')}</Label>
              <Input id="ed-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ed-purpose">{t('channels.form.purpose')}</Label>
              <Input id="ed-purpose" maxLength={80} value={purpose} placeholder={t('channels.form.purposePlaceholder')} onChange={(e) => setPurpose(e.target.value)} />
            </div>
          </div>

          {channel.type === 'webchat' ? (
            <>
              <WebchatSettingsFields value={webchat} onChange={setWebchat} />
              <CopyField multiline label={t('channels.webchat.snippet')} value={widgetSnippet(origin, channel.external_id)} />
            </>
          ) : (
            <div className="grid gap-3 rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">{t('channels.edit.credentialsHelp')}</p>
              <div className="grid gap-1.5">
                <Label htmlFor="ed-token">{t('channels.edit.newToken')}</Label>
                <Input id="ed-token" type="password" autoComplete="off" value={accessToken} placeholder="••••••••" onChange={(e) => setAccessToken(e.target.value)} />
              </div>
              {channel.type === 'whatsapp' && (
                <>
                  <div className="grid gap-1.5">
                    <Label htmlFor="ed-vt">{t('channels.edit.newVerifyToken')}</Label>
                    <Input id="ed-vt" autoComplete="off" value={verifyToken} onChange={(e) => setVerifyToken(e.target.value)} />
                  </div>
                  <CopyField label={t('channels.webhookUrl')} value={`${origin}/api/webhooks/meta`} />
                  <p className="text-xs text-muted-foreground">{t('channels.whatsapp.webhookHelp')}</p>
                </>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

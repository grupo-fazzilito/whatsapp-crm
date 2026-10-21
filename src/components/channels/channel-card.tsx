'use client';

import { Bot, EllipsisVertical, ListTree, Pencil, Power, Trash2, TriangleAlert } from 'lucide-react';
import { useT } from '@/i18n/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { CHANNEL_STYLE, selectClass, widgetSnippet, type AgentOption, type ChannelDTO } from './channel-types';
import { CopyField } from './copy-field';
import { readWelcomeMenu } from './welcome-menu-dialog';
import { MarketingMessagesBox } from './marketing-messages-box';

const STATUS_STYLE: Record<ChannelDTO['status'], string> = {
  connected: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  disconnected: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
  error: 'bg-red-500/10 text-red-600 dark:text-red-400',
};

interface Props {
  channel: ChannelDTO;
  agents: AgentOption[];
  isAdmin: boolean;
  origin: string;
  onAgentChange: (agentId: string | null) => void;
  onEdit: () => void;
  onEditMenu: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
}

export function ChannelCard({ channel, agents, isAdmin, origin, onAgentChange, onEdit, onEditMenu, onToggleStatus, onDelete }: Props) {
  const t = useT();
  const style = CHANNEL_STYLE[channel.type];
  const agent = agents.find((a) => a.id === channel.ai_agent_id);
  const menu = readWelcomeMenu(channel.settings);
  const menuOn = !!menu?.enabled && menu.options.length > 0;

  return (
    <Card className="flex flex-col">
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', style.tile)} aria-hidden>
            <style.icon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-foreground">{channel.name}</h3>
              {channel.purpose && <Badge variant="secondary">{channel.purpose}</Badge>}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {t(`channels.type.${channel.type}`)}
              {channel.display_handle ? ` · ${channel.display_handle}` : ''}
            </p>
          </div>
          {isAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon-sm" aria-label={t('channels.card.actions')} />}
              >
                <EllipsisVertical className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="size-4" />
                  {channel.type === 'webchat' ? t('channels.card.editWidget') : t('channels.card.edit')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onToggleStatus}>
                  <Power className="size-4" />
                  {channel.status === 'connected' ? t('channels.card.pause') : t('channels.card.resume')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
                  <Trash2 className="size-4" />
                  {t('channels.card.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium', STATUS_STYLE[channel.status])}>
            <span className="size-1.5 rounded-full bg-current" />
            {t(`channels.status.${channel.status}`)}
          </span>
        </div>

        {channel.status_detail && (
          <p className="flex items-start gap-1.5 rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span className="break-words">{channel.status_detail}</span>
          </p>
        )}

        <div className="grid gap-1.5">
          <label htmlFor={`agent-${channel.id}`} className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Bot className="size-3.5" />
            {t('channels.form.agent')}
          </label>
          {isAdmin ? (
            <select
              id={`agent-${channel.id}`}
              className={selectClass}
              value={channel.ai_agent_id ?? ''}
              onChange={(e) => onAgentChange(e.target.value || null)}
            >
              <option value="">{t('channels.noAgent')}</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.enabled ? '' : ` (${t('channels.agentDisabled')})`}
                </option>
              ))}
            </select>
          ) : (
            <p id={`agent-${channel.id}`} className="text-sm text-foreground">
              {agent ? agent.name : t('channels.noAgent')}
            </p>
          )}
          {agent && !agent.enabled && <p className="text-xs text-amber-600 dark:text-amber-400">{t('channels.agentDisabledHint')}</p>}
        </div>

        <div className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <ListTree className="size-3.5" />
              {t('routing.menu.title')}
            </p>
            <p className={cn('truncate text-xs', menuOn ? 'text-foreground' : 'text-muted-foreground')}>
              {menuOn ? t('routing.menu.summaryOn', { count: menu!.options.length }) : t('routing.menu.summaryOff')}
              {menuOn && menu!.question ? ` · ${menu!.question}` : ''}
            </p>
          </div>
          {(isAdmin || menu) && (
            <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={onEditMenu}>
              {isAdmin ? t('routing.menu.configure') : t('routing.menu.view')}
            </Button>
          )}
        </div>

        {channel.type === 'whatsapp' && <MarketingMessagesBox channel={channel} isAdmin={isAdmin} />}

        {channel.type === 'webchat' && (
          <div className="mt-auto">
            <CopyField multiline label={t('channels.webchat.snippet')} value={widgetSnippet(origin, channel.external_id)} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

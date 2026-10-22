'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Radio, MessageSquare, Tag, User, Palette, Users, ArrowRight, Zap, UsersRound, Coins, Plug, ListPlus } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TemplateManager } from '@/components/settings/template-manager';
import { TagManager } from '@/components/settings/tag-manager';
import { ProfileForm } from '@/components/settings/profile-form';
import { PasswordForm } from '@/components/settings/password-form';
import { SessionsCard } from '@/components/settings/sessions-card';
import { MyGoogleCalendarCard } from '@/components/integrations/google/my-calendar-card';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { TeamManager } from '@/components/settings/team-manager';
import { QuickRepliesManager } from '@/components/settings/quick-replies-manager';
import { CustomFieldsManager } from '@/components/settings/custom-fields-manager';
import { TeamsManager } from '@/components/settings/teams-manager';
import { useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { BillingPanel } from '@/components/billing/billing-panel';
import { CalendlyCard } from '@/components/integrations/calendly/calendly-card';
import { GoogleCalendarCard } from '@/components/integrations/google/google-calendar-card';

const TAB_VALUES = [
  'profile',
  'team',
  'whatsapp',
  'templates',
  'tags',
  'custom-fields',
  'quick-replies',
  'teams',
  'appearance',
  'billing',
  'integrations',
] as const;
type TabValue = (typeof TAB_VALUES)[number];

function isTabValue(v: string | null): v is TabValue {
  return !!v && (TAB_VALUES as readonly string[]).includes(v);
}

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useT();
  const { can } = useWorkspace();
  const isAdmin = can('admin');

  // The URL is the single source of truth for the active tab — no
  // local state, no sync effect. A previous revision duplicated this
  // into `useState` + a sync effect, which tripped React 19's
  // set-state-in-effect rule and was also redundant.
  const queryTab = searchParams.get('tab');
  const tab: TabValue = isTabValue(queryTab) ? queryTab : 'profile';

  const onChange = (next: TabValue) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Settings</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Manage your profile, WhatsApp® integration, message templates, and
          tags.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => onChange(v as TabValue)}>
        <TabsList className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800/60 p-1 h-10 w-fit max-w-full overflow-x-auto gap-1">
          <TabsTrigger
            value="profile"
            className="data-active:bg-white dark:data-active:bg-slate-800 data-active:text-primary text-slate-600 dark:text-slate-400 data-active:shadow-sm transition-all duration-200"
          >
            <User className="size-4" />
            Profile
          </TabsTrigger>
          <TabsTrigger
            value="team"
            className="data-active:bg-white dark:data-active:bg-slate-800 data-active:text-primary text-slate-600 dark:text-slate-400 data-active:shadow-sm transition-all duration-200"
          >
            <Users className="size-4" />
            {t('team.tab')}
          </TabsTrigger>
          <TabsTrigger
            value="whatsapp"
            className="data-active:bg-white dark:data-active:bg-slate-800 data-active:text-primary text-slate-600 dark:text-slate-400 data-active:shadow-sm transition-all duration-200"
          >
            <Radio className="size-4" />
            {t('channels.navTitle')}
          </TabsTrigger>
          <TabsTrigger
            value="templates"
            className="data-active:bg-white dark:data-active:bg-slate-800 data-active:text-primary text-slate-600 dark:text-slate-400 data-active:shadow-sm transition-all duration-200"
          >
            <MessageSquare className="size-4" />
            Templates
          </TabsTrigger>
          <TabsTrigger
            value="tags"
            className="data-active:bg-white dark:data-active:bg-slate-800 data-active:text-primary text-slate-600 dark:text-slate-400 data-active:shadow-sm transition-all duration-200"
          >
            <Tag className="size-4" />
            Tags
          </TabsTrigger>
          <TabsTrigger
            value="custom-fields"
            className="data-active:bg-white dark:data-active:bg-slate-800 data-active:text-primary text-slate-600 dark:text-slate-400 data-active:shadow-sm transition-all duration-200"
          >
            <ListPlus className="size-4" />
            {t('crm.customFields.tab')}
          </TabsTrigger>
          <TabsTrigger
            value="quick-replies"
            className="data-active:bg-white dark:data-active:bg-slate-800 data-active:text-primary text-slate-600 dark:text-slate-400 data-active:shadow-sm transition-all duration-200"
          >
            <Zap className="size-4" />
            {t('inboxpro.quickReplies.tab')}
          </TabsTrigger>
          <TabsTrigger
            value="teams"
            className="data-active:bg-white dark:data-active:bg-slate-800 data-active:text-primary text-slate-600 dark:text-slate-400 data-active:shadow-sm transition-all duration-200"
          >
            <UsersRound className="size-4" />
            {t('inboxpro.teams.tab')}
          </TabsTrigger>
          <TabsTrigger
            value="appearance"
            className="data-active:bg-white dark:data-active:bg-slate-800 data-active:text-primary text-slate-600 dark:text-slate-400 data-active:shadow-sm transition-all duration-200"
          >
            <Palette className="size-4" />
            Appearance
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger
              value="billing"
              className="data-active:bg-white dark:data-active:bg-slate-800 data-active:text-primary text-slate-600 dark:text-slate-400 data-active:shadow-sm transition-all duration-200"
            >
              <Coins className="size-4" />
              {t('billing.tab')}
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger
              value="integrations"
              className="data-active:bg-white dark:data-active:bg-slate-800 data-active:text-primary text-slate-600 dark:text-slate-400 data-active:shadow-sm transition-all duration-200"
            >
              <Plug className="size-4" />
              {t('calendly.tab')}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="profile" className="space-y-6">
          <ProfileForm />
          <MyGoogleCalendarCard />
          <PasswordForm />
          <SessionsCard />
        </TabsContent>

        <TabsContent value="team">
          <TeamManager />
        </TabsContent>

        {/* Kept as 'whatsapp' so old /settings?tab=whatsapp links still land here. */}
        <TabsContent value="whatsapp">
          <Card>
            <CardHeader>
              <CardTitle>{t('channels.settingsCard.title')}</CardTitle>
              <CardDescription>{t('channels.settingsCard.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/channels" className={buttonVariants()}>
                {t('channels.settingsCard.button')}
                <ArrowRight className="size-4" />
              </Link>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="templates">
          <TemplateManager />
        </TabsContent>

        <TabsContent value="tags">
          <TagManager />
        </TabsContent>

        <TabsContent value="custom-fields">
          <CustomFieldsManager />
        </TabsContent>

        <TabsContent value="quick-replies">
          <QuickRepliesManager />
        </TabsContent>

        <TabsContent value="teams">
          <TeamsManager />
        </TabsContent>

        <TabsContent value="appearance">
          <AppearancePanel />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="billing">
            <BillingPanel />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="integrations" className="space-y-6">
            <GoogleCalendarCard />
            <CalendlyCard />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

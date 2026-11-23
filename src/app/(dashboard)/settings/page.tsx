'use client';

import { useSearchParams } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { activeSubTab, settingsTabs } from '@/components/layout/nav-groups';
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
import { ApiKeysCard } from '@/components/integrations/api/api-keys-card';
import { WebhooksCard } from '@/components/integrations/api/webhooks-card';

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const t = useT();
  const { can } = useWorkspace();
  const isAdmin = can('admin');

  // The URL is the single source of truth: the inner menu on the left links to ?tab=<key>.
  const tab = activeSubTab(settingsTabs({ t, isAdmin }), searchParams.get('tab'));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('settingsPage.title')}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('settingsPage.description')}</p>
      </div>

      <Tabs value={tab}>
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
            <ApiKeysCard />
            <WebhooksCard />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

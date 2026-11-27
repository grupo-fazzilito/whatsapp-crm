'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { activeSubTab, settingsTabs } from '@/components/layout/nav-groups';
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
import { BackupCard } from '@/components/settings/backup-card';

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const t = useT();
  const { can } = useWorkspace();
  const isAdmin = can('admin');

  // The URL is the single source of truth: the inner menu on the left links to ?tab=<key>.
  const tab = activeSubTab(settingsTabs({ t, isAdmin }), searchParams.get('tab'));

  // Channels moved to their own page: old /settings?tab=whatsapp links go there.
  const legacyChannels = searchParams.get('tab') === 'whatsapp';
  useEffect(() => {
    if (legacyChannels) router.replace('/channels');
  }, [legacyChannels, router]);

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

        {isAdmin && (
          <TabsContent value="backup">
            <BackupCard />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

'use client';

import { useSearchParams } from 'next/navigation';
import { useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { activeSubTab, setupTabs } from '@/components/layout/nav-groups';
import { LoadingBlock, Notice, PageHeader } from '../shared';
import { ProfileForm } from './profile-form';
import { IndustryForm } from './industry-form';
import { HoursForm } from './hours-form';
import { OrdersPaymentsForm } from './orders-payments-form';
import { RoutingRulesManager } from '@/components/real-estate/routing/routing-rules-manager';

export function BusinessSetup() {
  const t = useT();
  const { workspace, can, modules } = useWorkspace();
  const readOnly = !can('admin');
  const searchParams = useSearchParams();
  // The inner menu on the left links to ?tab=<key>; options the business doesn't use fall back to the first.
  const tab = activeSubTab(setupTabs({ t, modules, industry: workspace?.industry }), searchParams.get('tab'));

  return (
    <div className="space-y-6">
      <PageHeader title={t('business.setup.title')} description={t('business.setup.description')} />
      {readOnly && <Notice>{t('business.common.readOnly')}</Notice>}
      {!workspace ? (
        <LoadingBlock />
      ) : (
        <Tabs value={tab}>
          {/* key = workspace version, so forms re-seed after a save/refresh. */}
          <TabsContent value="profile" className="pt-2">
            <ProfileForm key={workspace.updated_at} workspace={workspace} readOnly={readOnly} />
          </TabsContent>
          <TabsContent value="industry" className="pt-2">
            <IndustryForm key={workspace.updated_at} workspace={workspace} readOnly={readOnly} />
          </TabsContent>
          <TabsContent value="hours" className="pt-2">
            <HoursForm workspace={workspace} readOnly={readOnly} />
          </TabsContent>
          {modules.orders && (
            <TabsContent value="orders" className="pt-2">
              <OrdersPaymentsForm key={workspace.updated_at} workspace={workspace} readOnly={readOnly} />
            </TabsContent>
          )}
          {workspace.industry === 'real_estate' && (
            <TabsContent value="leadRouting" className="pt-2">
              <RoutingRulesManager />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}

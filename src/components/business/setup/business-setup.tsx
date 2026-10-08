'use client';

import { useState } from 'react';
import { useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadingBlock, Notice, PageHeader } from '../shared';
import { ProfileForm } from './profile-form';
import { IndustryForm } from './industry-form';
import { HoursForm } from './hours-form';
import { OrdersPaymentsForm } from './orders-payments-form';

const TABS = ['profile', 'industry', 'hours', 'orders'] as const;
type Tab = (typeof TABS)[number];

export function BusinessSetup() {
  const t = useT();
  const { workspace, can, modules } = useWorkspace();
  const readOnly = !can('admin');
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === 'undefined') return 'profile';
    const q = new URLSearchParams(window.location.search).get('tab');
    return (TABS as readonly string[]).includes(q ?? '') ? (q as Tab) : 'profile';
  });

  const onTab = (v: unknown) => {
    const next = String(v) as Tab;
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url);
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t('business.setup.title')} description={t('business.setup.description')} />
      {readOnly && <Notice>{t('business.common.readOnly')}</Notice>}
      {!workspace ? (
        <LoadingBlock />
      ) : (
        <Tabs value={tab === 'orders' && !modules.orders ? 'profile' : tab} onValueChange={onTab}>
          <TabsList>
            {TABS.filter((k) => k !== 'orders' || modules.orders).map((k) => (
              <TabsTrigger key={k} value={k} className="px-3">
                {k === 'orders' ? t('orders.settings.tab') : t(`business.setup.tab.${k}`)}
              </TabsTrigger>
            ))}
          </TabsList>
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
        </Tabs>
      )}
    </div>
  );
}

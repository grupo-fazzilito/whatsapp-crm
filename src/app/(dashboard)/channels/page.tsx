import { Suspense } from 'react';
import { ChannelsManager } from '@/components/channels/channels-manager';

export default function ChannelsPage() {
  return (
    <Suspense>
      <ChannelsManager />
    </Suspense>
  );
}

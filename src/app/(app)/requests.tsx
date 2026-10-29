import { RequestsView } from '@/components/RequestCard';
import { AppHeader, Screen } from '@/components/ui';

export default function RequestsScreen() {
  return (
    <Screen scroll={false} padded={false} keyboard={false} edges={['top']} header={<AppHeader title="Requests" subtitle="People who want to connect" />}>
      <RequestsView />
    </Screen>
  );
}

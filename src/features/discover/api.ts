import { rpc } from '@/lib/rpc';
import type { DiscoverDashboard, TalkMatch } from '@/types/domain';

export const discoverApi = {
  dashboard: () => rpc<DiscoverDashboard>('discover_dashboard'),
  /** Top 5 people (requires Open to Talk). */
  talkMatches: () => rpc<TalkMatch[]>('talk_matches', { p_limit: 5 }),
};

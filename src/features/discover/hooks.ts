import { useQuery } from '@tanstack/react-query';

import { discoverApi } from './api';

export const useDashboard = (enabled = true) =>
  useQuery({ queryKey: ['dashboard'], queryFn: discoverApi.dashboard, enabled, staleTime: 60_000 });

export const useTalkMatches = (enabled: boolean) =>
  useQuery({ queryKey: ['talk-matches'], queryFn: discoverApi.talkMatches, enabled, staleTime: 30_000 });

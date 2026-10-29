import type { QueryClient } from '@tanstack/react-query';

import { createInvalidationBatch } from '../invalidation-batch';

describe('realtime invalidation batching', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('turns a burst into one active-query refetch per key', () => {
    const invalidateQueries = jest.fn().mockResolvedValue(undefined);
    const batch = createInvalidationBatch({ invalidateQueries } as unknown as QueryClient, 200);
    for (let i = 0; i < 100; i++) batch.add(['conversations'], true);
    for (let i = 0; i < 50; i++) batch.add(['chat-badge'], true);
    jest.advanceTimersByTime(199);
    expect(invalidateQueries).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['conversations'], exact: true, refetchType: 'active' });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['chat-badge'], exact: true, refetchType: 'active' });
  });

  it('cancels pending work when a channel unmounts', () => {
    const invalidateQueries = jest.fn();
    const batch = createInvalidationBatch({ invalidateQueries } as unknown as QueryClient);
    batch.add(['messages', 'one'], true);
    batch.dispose();
    jest.runAllTimers();
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});

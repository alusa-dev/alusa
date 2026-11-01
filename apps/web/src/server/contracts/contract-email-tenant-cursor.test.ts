import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ lastTenantId: null as string | null, ids: ['school-a', 'school-b', 'school-c', 'school-d', 'school-e'] }));
const mocks = vi.hoisted(() => ({ upsert: vi.fn(), update: vi.fn(), queryRaw: vi.fn(), findMany: vi.fn(), transaction: vi.fn() }));

vi.mock('@/lib/email/transactional-email', () => ({ sendTransactionalEmail: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock('@/lib/prisma-tenant', () => ({ runWithTenant: vi.fn() }));
vi.mock('@alusa/database', () => ({ decryptSecret: vi.fn() }));
vi.mock('@alusa/domain', () => ({ isMaiorDeIdade: vi.fn() }));

import { selectContractNotificationTenantIdsForRun } from './contract-email-notification.service';

describe('contract notification tenant cursor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.lastTenantId = null;
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      webhookJobLock: {
        upsert: mocks.upsert.mockResolvedValue({}),
        update: mocks.update.mockImplementation(async ({ data }: { data: { metadata: { lastTenantId: string } } }) => {
          state.lastTenantId = data.metadata.lastTenantId;
        }),
      },
      $queryRaw: mocks.queryRaw.mockImplementation(async () => [{ metadata: { lastTenantId: state.lastTenantId } }]),
      conta: {
        findMany: mocks.findMany.mockImplementation(async ({ where, take }: { where?: { id?: { gt?: string; lte?: string } }; take: number }) => {
          const ids = state.ids.filter((id) => {
            if (where?.id?.gt) return id > where.id.gt;
            if (where?.id?.lte) return id <= where.id.lte;
            return true;
          });
          return ids.slice(0, take).map((id) => ({ id }));
        }),
      },
    }));
  });

  it('advances a bounded cursor across successive runs and wraps fairly', async () => {
    const first = await selectContractNotificationTenantIdsForRun({ limit: 2 });
    const second = await selectContractNotificationTenantIdsForRun({ limit: 2 });
    const third = await selectContractNotificationTenantIdsForRun({ limit: 2 });

    expect(first.map(({ id }) => id)).toEqual(['school-a', 'school-b']);
    expect(second.map(({ id }) => id)).toEqual(['school-c', 'school-d']);
    expect(third.map(({ id }) => id)).toEqual(['school-e', 'school-a']);
    expect(mocks.update).toHaveBeenNthCalledWith(1, expect.objectContaining({ data: { metadata: { lastTenantId: 'school-b' } } }));
    expect(mocks.update).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: { metadata: { lastTenantId: 'school-d' } } }));
    expect(mocks.update).toHaveBeenNthCalledWith(3, expect.objectContaining({ data: { metadata: { lastTenantId: 'school-a' } } }));
    expect(mocks.upsert).toHaveBeenCalledTimes(3);
  });
});

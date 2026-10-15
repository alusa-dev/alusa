import { describe, expect, it, vi } from 'vitest';
import { resolvePlatformBillingActor } from './platform-billing-server';

function createTx(input: {
  userStatus?: 'ATIVO' | 'INATIVO';
  membershipStatus?: 'ATIVO' | 'INATIVO';
  membershipRole?: 'ADMIN' | 'FINANCEIRO';
  contaStatus?: 'ATIVO' | 'INATIVO';
  deletedAt?: Date | null;
}) {
  return {
    usuario: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'user-a',
        nome: 'Admin',
        email: 'admin@example.test',
        role: 'ADMIN',
        status: input.userStatus ?? 'ATIVO',
      }),
    },
    usuarioConta: {
      findUnique: vi.fn().mockResolvedValue({
        role: input.membershipRole ?? 'ADMIN',
        status: input.membershipStatus ?? 'ATIVO',
      }),
    },
    conta: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'conta-a',
        nome: 'Escola',
        status: input.contaStatus ?? 'ATIVO',
        deletedAt: input.deletedAt ?? null,
      }),
    },
  };
}

describe('resolvePlatformBillingActor', () => {
  it('does not authorize billing management through an inactive ADMIN membership', async () => {
    const tx = createTx({ membershipStatus: 'INATIVO' });

    const actor = await resolvePlatformBillingActor({
      tx: tx as never,
      contaId: 'conta-a',
      userId: 'user-a',
    });

    expect(actor.role).toBe('ADMIN');
    expect(actor.canManagePlatformBilling).toBe(false);
  });

  it('requires active user and Conta in addition to an active billing role membership', async () => {
    const inactiveUser = await resolvePlatformBillingActor({
      tx: createTx({ userStatus: 'INATIVO' }) as never,
      contaId: 'conta-a',
      userId: 'user-a',
    });
    const inactiveConta = await resolvePlatformBillingActor({
      tx: createTx({ contaStatus: 'INATIVO' }) as never,
      contaId: 'conta-a',
      userId: 'user-a',
    });

    expect(inactiveUser.canManagePlatformBilling).toBe(false);
    expect(inactiveConta.canManagePlatformBilling).toBe(false);
  });

  it('does not authorize a deleted Conta and accepts an active FINANCEIRO membership', async () => {
    const deletedConta = await resolvePlatformBillingActor({
      tx: createTx({ deletedAt: new Date() }) as never,
      contaId: 'conta-a',
      userId: 'user-a',
    });
    const financeiro = await resolvePlatformBillingActor({
      tx: createTx({ membershipRole: 'FINANCEIRO' }) as never,
      contaId: 'conta-a',
      userId: 'user-a',
    });

    expect(deletedConta.canManagePlatformBilling).toBe(false);
    expect(financeiro.canManagePlatformBilling).toBe(true);
  });

  it('authorizes an active ADMIN membership in an active Conta', async () => {
    const actor = await resolvePlatformBillingActor({
      tx: createTx({ membershipRole: 'ADMIN' }) as never,
      contaId: 'conta-a',
      userId: 'user-a',
    });

    expect(actor.canManagePlatformBilling).toBe(true);
  });
});

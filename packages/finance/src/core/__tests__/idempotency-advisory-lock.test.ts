import { describe, it, expect, vi } from 'vitest';
import {
  buildGuardKey,
  acquireGuardLock,
} from '../../core/idempotency.service';

describe('idempotency advisory lock (transacional)', () => {
  it('buildGuardKey deve gerar chave determinística', () => {
    const key1 = buildGuardKey({ contaId: 'c1', scope: 'charge-create', key: 'k1' });
    const key2 = buildGuardKey({ contaId: 'c1', scope: 'charge-create', key: 'k1' });
    expect(key1).toBe(key2);
    expect(key1).toBe('c1:charge-create:k1');
  });

  it('buildGuardKey deve variar com inputs diferentes', () => {
    const key1 = buildGuardKey({ contaId: 'c1', scope: 'charge-create', key: 'k1' });
    const key2 = buildGuardKey({ contaId: 'c1', scope: 'installment-create', key: 'k1' });
    expect(key1).not.toBe(key2);
  });

  it('acquireGuardLock deve chamar pg_advisory_xact_lock com bigint', async () => {
    const mockQueryRaw = vi.fn().mockResolvedValue([]);

    await acquireGuardLock({
      tx: { $queryRaw: mockQueryRaw },
      contaId: 'conta-1',
      scope: 'installment-create',
      key: 'test-key',
    });

    expect(mockQueryRaw).toHaveBeenCalledTimes(1);

    const call = mockQueryRaw.mock.calls[0];
    // Tagged template: primeiro arg é TemplateStringsArray, restante são os valores interpolados
    const templateParts = call[0];
    const lockKeyValue = call[1];

    // Verifica que o SQL contém pg_advisory_xact_lock
    expect(templateParts[0]).toContain('SELECT pg_advisory_xact_lock(');

    // Verifica que o valor é bigint (fix do P2010)
    expect(typeof lockKeyValue).toBe('bigint');
  });

  it('acquireGuardLock deve gerar o mesmo lock key para os mesmos params', async () => {
    const keys: bigint[] = [];
    const mockQueryRaw = vi.fn().mockImplementation((_tpl: unknown, key: bigint) => {
      keys.push(key);
      return Promise.resolve([]);
    });

    const params = {
      tx: { $queryRaw: mockQueryRaw },
      contaId: 'c1',
      scope: 'charge-create' as const,
      key: 'k1',
    };

    await acquireGuardLock(params);
    await acquireGuardLock(params);

    expect(keys[0]).toBe(keys[1]);
  });

  it('acquireGuardLock deve gerar lock keys diferentes para params diferentes', async () => {
    const keys: bigint[] = [];
    const mockQueryRaw = vi.fn().mockImplementation((_tpl: unknown, key: bigint) => {
      keys.push(key);
      return Promise.resolve([]);
    });

    await acquireGuardLock({
      tx: { $queryRaw: mockQueryRaw },
      contaId: 'c1',
      scope: 'charge-create',
      key: 'k1',
    });

    await acquireGuardLock({
      tx: { $queryRaw: mockQueryRaw },
      contaId: 'c2',
      scope: 'installment-create',
      key: 'k2',
    });

    expect(keys[0]).not.toBe(keys[1]);
  });
});

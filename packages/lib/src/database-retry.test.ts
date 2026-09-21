import { describe, expect, it, vi } from 'vitest';

import { isTransientDatabaseError, withDatabaseRetry } from './database-retry';

describe('database retry policy', () => {
  it('classifica timeout de pool como transitório', () => {
    expect(isTransientDatabaseError(new Error('P2024: connection pool timeout'))).toBe(true);
  });

  it('repete apenas uma vez por padrão e retorna o resultado', async () => {
    const operation = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error('connection reset by peer'))
      .mockResolvedValueOnce(7);

    await expect(withDatabaseRetry(operation, { delayMs: 0 })).resolves.toBe(7);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('não repete erros não transitórios', async () => {
    const operation = vi.fn<() => Promise<number>>().mockRejectedValue(new Error('invalid query'));

    await expect(withDatabaseRetry(operation, { delayMs: 0 })).rejects.toThrow('invalid query');
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

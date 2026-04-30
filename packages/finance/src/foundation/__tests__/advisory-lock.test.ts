import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  advisoryLockKey64,
  tryAcquireAdvisoryLock,
  releaseAdvisoryLock,
  withAdvisoryLock,
} from '../advisory-lock';

describe('advisoryLockKey64', () => {
  it('deve ser determinístico (mesma string → mesmo bigint)', () => {
    const key = 'create-asaas-account:abc123';
    const result1 = advisoryLockKey64(key);
    const result2 = advisoryLockKey64(key);

    expect(result1).toBe(result2);
    expect(typeof result1).toBe('bigint');
  });

  it('deve variar com input diferente', () => {
    const key1 = 'create-asaas-account:abc123';
    const key2 = 'create-asaas-account:xyz789';

    const result1 = advisoryLockKey64(key1);
    const result2 = advisoryLockKey64(key2);

    expect(result1).not.toBe(result2);
  });

  it('deve retornar bigint não-negativo', () => {
    const keys = [
      'test-lock:1',
      'create-asaas-account:uuid-1234',
      'some-very-long-lock-key-with-many-characters',
      '',
    ];

    for (const key of keys) {
      const result = advisoryLockKey64(key);
      expect(result >= 0n).toBe(true);
    }
  });

  it('deve gerar bigint de 64 bits (dentro do range)', () => {
    const key = 'test-lock:12345';
    const result = advisoryLockKey64(key);

    // Máximo de 64 bits unsigned: 2^64 - 1
    const max64bit = BigInt('0xFFFFFFFFFFFFFFFF');
    expect(result <= max64bit).toBe(true);
  });
});

describe('tryAcquireAdvisoryLock', () => {
  it('deve retornar true quando lock é adquirido', async () => {
    const mockPrisma = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ locked: true }]),
    };

    const result = await tryAcquireAdvisoryLock('test-lock:1', {
      prisma: mockPrisma as any,
    });

    expect(result).toBe(true);
    expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalled();
  });

  it('deve retornar false quando lock não é adquirido', async () => {
    const mockPrisma = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ locked: false }]),
    };

    const result = await tryAcquireAdvisoryLock('test-lock:2', {
      prisma: mockPrisma as any,
    });

    expect(result).toBe(false);
  });

  it('deve retornar false em caso de erro', async () => {
    const mockPrisma = {
      $queryRawUnsafe: vi.fn().mockRejectedValue(new Error('DB connection failed')),
    };

    const result = await tryAcquireAdvisoryLock('test-lock:3', {
      prisma: mockPrisma as any,
    });

    expect(result).toBe(false);
  });
});

describe('releaseAdvisoryLock', () => {
  it('deve retornar true quando lock é liberado', async () => {
    const mockPrisma = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ unlocked: true }]),
    };

    const result = await releaseAdvisoryLock('test-lock:1', {
      prisma: mockPrisma as any,
    });

    expect(result).toBe(true);
    expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalled();
  });

  it('não deve gerar warning quando unlock retorna false', async () => {
    const mockPrisma = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ unlocked: false }]),
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await releaseAdvisoryLock('test-lock:1', {
      prisma: mockPrisma as any,
    });

    expect(result).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('deve retornar false em caso de erro', async () => {
    const mockPrisma = {
      $queryRawUnsafe: vi.fn().mockRejectedValue(new Error('DB error')),
    };

    const result = await releaseAdvisoryLock('test-lock:1', {
      prisma: mockPrisma as any,
    });

    expect(result).toBe(false);
  });
});

describe('withAdvisoryLock', () => {
  it('quando lock retorna false, não deve executar fn', async () => {
    const mockPrisma = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ locked: false }]),
    };
    const fn = vi.fn().mockResolvedValue('result');

    const result = await withAdvisoryLock('test-lock:1', fn, {
      prisma: mockPrisma as any,
    });

    expect(result.acquired).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it('quando lock retorna true, deve executar fn e chamar unlock', async () => {
    const mockPrisma = {
      $queryRawUnsafe: vi
        .fn()
        .mockResolvedValueOnce([{ locked: true }]) // tryAcquire
        .mockResolvedValueOnce([{ unlocked: true }]), // release
    };
    const fn = vi.fn().mockResolvedValue('test-result');

    const result = await withAdvisoryLock('test-lock:1', fn, {
      prisma: mockPrisma as any,
    });

    expect(result.acquired).toBe(true);
    if (result.acquired) {
      expect(result.result).toBe('test-result');
    }
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledTimes(2); // acquire + release
  });

  it('quando fn lança erro, deve chamar unlock no finally', async () => {
    const mockPrisma = {
      $queryRawUnsafe: vi
        .fn()
        .mockResolvedValueOnce([{ locked: true }]) // tryAcquire
        .mockResolvedValueOnce([{ unlocked: true }]), // release
    };
    const fn = vi.fn().mockRejectedValue(new Error('fn failed'));

    await expect(
      withAdvisoryLock('test-lock:1', fn, { prisma: mockPrisma as any }),
    ).rejects.toThrow('fn failed');

    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledTimes(2); // acquire + release
  });

  it('deve passar logContext corretamente', async () => {
    const mockPrisma = {
      $queryRawUnsafe: vi
        .fn()
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([{ unlocked: true }]),
    };
    const fn = vi.fn().mockResolvedValue('result');

    await withAdvisoryLock('test-lock:1', fn, {
      prisma: mockPrisma as any,
      logContext: { contaId: 'conta-123', financeProfileId: 'fp-456' },
    });

    expect(fn).toHaveBeenCalled();
  });
});

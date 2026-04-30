import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker';

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, failureStatuses: [429, 500, 502, 503, 504] });
  });

  describe('estado inicial', () => {
    it('deve começar CLOSED', () => {
      expect(cb.getState('acc1')).toBe('CLOSED');
    });

    it('deve permitir execução em CLOSED', () => {
      const result = cb.canExecute('acc1');
      expect(result.allowed).toBe(true);
      expect(result.state).toBe('CLOSED');
    });
  });

  describe('transição CLOSED → OPEN', () => {
    it('deve abrir após atingir failureThreshold com status de falha', () => {
      cb.recordFailure('acc1', 500);
      cb.recordFailure('acc1', 500);
      expect(cb.getState('acc1')).toBe('CLOSED');

      cb.recordFailure('acc1', 500);
      expect(cb.getState('acc1')).toBe('OPEN');
    });

    it('deve bloquear execução quando OPEN', () => {
      cb.recordFailure('acc1', 500);
      cb.recordFailure('acc1', 500);
      cb.recordFailure('acc1', 500);

      const result = cb.canExecute('acc1');
      expect(result.allowed).toBe(false);
      expect(result.state).toBe('OPEN');
      expect(result.waitMs).toBeGreaterThan(0);
    });

    it('deve contar 429 como falha', () => {
      cb.recordFailure('acc1', 429);
      cb.recordFailure('acc1', 429);
      cb.recordFailure('acc1', 429);
      expect(cb.getState('acc1')).toBe('OPEN');
    });

    it('não deve contar 400 como falha', () => {
      cb.recordFailure('acc1', 400);
      cb.recordFailure('acc1', 400);
      cb.recordFailure('acc1', 400);
      expect(cb.getState('acc1')).toBe('CLOSED');
    });

    it('não deve contar 404 como falha', () => {
      cb.recordFailure('acc1', 404);
      cb.recordFailure('acc1', 404);
      cb.recordFailure('acc1', 404);
      expect(cb.getState('acc1')).toBe('CLOSED');
    });
  });

  describe('transição OPEN → HALF_OPEN', () => {
    it('deve transicionar para HALF_OPEN após cooldown', () => {
      vi.useFakeTimers();

      cb.recordFailure('acc1', 500);
      cb.recordFailure('acc1', 500);
      cb.recordFailure('acc1', 500);
      expect(cb.getState('acc1')).toBe('OPEN');

      vi.advanceTimersByTime(1001);
      const result = cb.canExecute('acc1');
      expect(result.allowed).toBe(true);
      expect(result.state).toBe('HALF_OPEN');

      vi.useRealTimers();
    });
  });

  describe('transição HALF_OPEN → CLOSED', () => {
    it('deve fechar o circuito com sucesso em HALF_OPEN', () => {
      vi.useFakeTimers();

      cb.recordFailure('acc1', 500);
      cb.recordFailure('acc1', 500);
      cb.recordFailure('acc1', 500);

      vi.advanceTimersByTime(1001);
      cb.canExecute('acc1'); // transitions to HALF_OPEN

      cb.recordSuccess('acc1');
      expect(cb.getState('acc1')).toBe('CLOSED');

      const result = cb.canExecute('acc1');
      expect(result.allowed).toBe(true);
      expect(result.state).toBe('CLOSED');

      vi.useRealTimers();
    });
  });

  describe('transição HALF_OPEN → OPEN', () => {
    it('deve reabrir se falhar em HALF_OPEN', () => {
      vi.useFakeTimers();

      cb.recordFailure('acc1', 500);
      cb.recordFailure('acc1', 500);
      cb.recordFailure('acc1', 500);

      vi.advanceTimersByTime(1001);
      cb.canExecute('acc1'); // HALF_OPEN

      cb.recordFailure('acc1', 500);
      expect(cb.getState('acc1')).toBe('OPEN');

      vi.useRealTimers();
    });
  });

  describe('reset', () => {
    it('deve resetar circuito individual', () => {
      cb.recordFailure('acc1', 500);
      cb.recordFailure('acc1', 500);
      cb.recordFailure('acc1', 500);
      expect(cb.getState('acc1')).toBe('OPEN');

      cb.reset('acc1');
      expect(cb.getState('acc1')).toBe('CLOSED');
    });

    it('deve resetar todos os circuitos', () => {
      cb.recordFailure('acc1', 500);
      cb.recordFailure('acc1', 500);
      cb.recordFailure('acc1', 500);
      cb.recordFailure('acc2', 500);
      cb.recordFailure('acc2', 500);
      cb.recordFailure('acc2', 500);

      cb.resetAll();
      expect(cb.getState('acc1')).toBe('CLOSED');
      expect(cb.getState('acc2')).toBe('CLOSED');
    });
  });

  describe('isolamento por chave', () => {
    it('deve isolar circuitos entre chaves diferentes', () => {
      cb.recordFailure('acc1', 500);
      cb.recordFailure('acc1', 500);
      cb.recordFailure('acc1', 500);

      expect(cb.getState('acc1')).toBe('OPEN');
      expect(cb.getState('acc2')).toBe('CLOSED');
    });
  });

  describe('sucesso reseta contador', () => {
    it('deve zerar falhas após sucesso', () => {
      cb.recordFailure('acc1', 500);
      cb.recordFailure('acc1', 500);
      cb.recordSuccess('acc1');

      cb.recordFailure('acc1', 500);
      cb.recordFailure('acc1', 500);
      expect(cb.getState('acc1')).toBe('CLOSED');
    });
  });

  describe('snapshot', () => {
    it('deve retornar snapshot com estado correto', () => {
      cb.recordFailure('acc1', 500);
      cb.recordFailure('acc1', 500);

      const snapshot = cb.getSnapshot('acc1');
      expect(snapshot.state).toBe('CLOSED');
      expect(snapshot.failures).toBe(2);
    });

    it('deve retornar todos os snapshots', () => {
      cb.recordFailure('acc1', 500);
      cb.recordSuccess('acc2');

      const all = cb.allSnapshots();
      expect(Object.keys(all)).toContain('acc1');
      expect(Object.keys(all)).toContain('acc2');
    });
  });

  describe('CircuitOpenError', () => {
    it('deve conter código e tempo de espera', () => {
      const error = new CircuitOpenError('acc1', 5000);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('CircuitOpenError');
      expect(error.code).toBe('CIRCUIT_OPEN');
      expect(error.waitMs).toBe(5000);
      expect(error.message).toContain('acc1');
    });
  });
});

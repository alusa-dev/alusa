import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QuotaTracker } from './quota-tracker';

describe('QuotaTracker', () => {
  let tracker: QuotaTracker;

  beforeEach(() => {
    tracker = new QuotaTracker(100); // limite baixo para testes
  });

  describe('increment', () => {
    it('deve incrementar contagem', () => {
      const status = tracker.increment('acc1');
      expect(status.count).toBe(1);
      expect(status.limit).toBe(100);
      expect(status.remaining).toBe(99);
    });

    it('deve retornar warning=false abaixo de 80%', () => {
      for (let i = 0; i < 79; i++) tracker.increment('acc1');
      const status = tracker.getStatus('acc1');
      expect(status.warning).toBe(false);
      expect(status.percentUsed).toBe(79);
    });

    it('deve retornar warning=true a 80%', () => {
      for (let i = 0; i < 80; i++) tracker.increment('acc1');
      const status = tracker.getStatus('acc1');
      expect(status.warning).toBe(true);
      expect(status.percentUsed).toBe(80);
    });

    it('deve retornar exceeded=true no limite', () => {
      for (let i = 0; i < 100; i++) tracker.increment('acc1');
      const status = tracker.getStatus('acc1');
      expect(status.exceeded).toBe(true);
      expect(status.remaining).toBe(0);
    });

    it('deve retornar remaining=0 além do limite', () => {
      for (let i = 0; i < 105; i++) tracker.increment('acc1');
      const status = tracker.getStatus('acc1');
      expect(status.remaining).toBe(0);
    });
  });

  describe('isolamento por chave', () => {
    it('deve isolar contagem entre contas', () => {
      tracker.increment('acc1');
      tracker.increment('acc1');
      tracker.increment('acc2');

      expect(tracker.getStatus('acc1').count).toBe(2);
      expect(tracker.getStatus('acc2').count).toBe(1);
    });
  });

  describe('window reset', () => {
    it('deve resetar contagem quando janela expirar', () => {
      vi.useFakeTimers();

      tracker.increment('acc1');
      expect(tracker.getStatus('acc1').count).toBe(1);

      // Avançar 12h + 1ms
      vi.advanceTimersByTime(12 * 60 * 60 * 1000 + 1);

      const status = tracker.getStatus('acc1');
      expect(status.count).toBe(0);

      vi.useRealTimers();
    });
  });

  describe('reset manual', () => {
    it('deve resetar conta individual', () => {
      tracker.increment('acc1');
      tracker.increment('acc1');
      tracker.reset('acc1');
      expect(tracker.getStatus('acc1').count).toBe(0);
    });

    it('deve resetar todas as contas', () => {
      tracker.increment('acc1');
      tracker.increment('acc2');
      tracker.resetAll();
      expect(tracker.getStatus('acc1').count).toBe(0);
      expect(tracker.getStatus('acc2').count).toBe(0);
    });
  });

  describe('allSnapshots', () => {
    it('deve retornar snapshot de todas as contas', () => {
      tracker.increment('acc1');
      tracker.increment('acc2');

      const snapshots = tracker.allSnapshots();
      expect(Object.keys(snapshots)).toContain('acc1');
      expect(Object.keys(snapshots)).toContain('acc2');
      expect(snapshots['acc1'].count).toBe(1);
    });
  });

  describe('windowEndsIn', () => {
    it('deve retornar formato legível', () => {
      const status = tracker.increment('acc1');
      // Janela acabou de iniciar (~12h restantes)
      expect(status.windowEndsIn).toMatch(/\d+h/);
    });
  });

  describe('construtor', () => {
    it('deve aceitar limite mínimo de 1', () => {
      const t = new QuotaTracker(0);
      expect(t.limit).toBe(1);
    });

    it('deve aceitar limite negativo como 1', () => {
      const t = new QuotaTracker(-5);
      expect(t.limit).toBe(1);
    });
  });
});

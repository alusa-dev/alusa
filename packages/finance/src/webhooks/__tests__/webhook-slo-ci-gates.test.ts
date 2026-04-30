import { describe, expect, it } from 'vitest';
import {
  evaluateWebhookSLOs,
  calculateRegistryMetrics,
  validateCriticalEventsCoverage,
  assertCriticalEventsCovered,
} from '../webhook-observability.service';

describe('Webhook SLO Evaluation', () => {
  describe('evaluateWebhookSLOs', () => {
    it('deve retornar ok quando todos os SLOs são atendidos', () => {
      const result = evaluateWebhookSLOs({
        lagSeconds: 60,
        backlog: 10,
        errored: 1,
        processed: 100,
        exhausted: 0,
      });

      expect(result.ok).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('deve detectar violação de lag', () => {
      const result = evaluateWebhookSLOs({
        lagSeconds: 600,
        backlog: 10,
        errored: 0,
        processed: 100,
      });

      expect(result.ok).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].metric).toBe('lag_seconds');
      expect(result.violations[0].severity).toBe('warning');
    });

    it('deve marcar lag critical quando > 3x threshold', () => {
      const result = evaluateWebhookSLOs({
        lagSeconds: 1200,
        backlog: 10,
        errored: 0,
        processed: 100,
      });

      expect(result.violations[0].severity).toBe('critical');
    });

    it('deve detectar violação de backlog', () => {
      const result = evaluateWebhookSLOs({
        lagSeconds: null,
        backlog: 600,
        errored: 0,
        processed: 100,
      });

      expect(result.ok).toBe(false);
      expect(result.violations[0].metric).toBe('backlog');
    });

    it('deve detectar violação de error rate', () => {
      const result = evaluateWebhookSLOs({
        lagSeconds: null,
        backlog: 0,
        errored: 20,
        processed: 80,
      });

      expect(result.ok).toBe(false);
      expect(result.violations[0].metric).toBe('error_rate');
    });

    it('deve detectar exhausted/DLQ acima do limite', () => {
      const result = evaluateWebhookSLOs({
        lagSeconds: null,
        backlog: 0,
        errored: 0,
        processed: 100,
        exhausted: 15,
      });

      expect(result.ok).toBe(false);
      expect(result.violations[0].metric).toBe('exhausted_dlq');
      expect(result.violations[0].severity).toBe('critical');
    });

    it('deve respeitar thresholds customizados', () => {
      const result = evaluateWebhookSLOs(
        { lagSeconds: 120, backlog: 10, errored: 0, processed: 100 },
        { maxLagSeconds: 60 },
      );

      expect(result.ok).toBe(false);
      expect(result.violations[0].metric).toBe('lag_seconds');
    });

    it('deve detectar múltiplas violações simultâneas', () => {
      const result = evaluateWebhookSLOs({
        lagSeconds: 600,
        backlog: 600,
        errored: 20,
        processed: 80,
        exhausted: 15,
      });

      expect(result.ok).toBe(false);
      expect(result.violations.length).toBeGreaterThanOrEqual(3);
    });

    it('não deve reportar violação com fila vazia', () => {
      const result = evaluateWebhookSLOs({
        lagSeconds: null,
        backlog: 0,
        errored: 0,
        processed: 0,
      });

      expect(result.ok).toBe(true);
    });
  });

  describe('CI Gates - Registry Integrity', () => {
    it('calculateRegistryMetrics deve retornar métricas válidas', () => {
      const metrics = calculateRegistryMetrics();

      expect(metrics.totalEvents).toBeGreaterThan(50);
      expect(metrics.handledEvents).toBeGreaterThan(30);
      expect(metrics.handledEvents + metrics.unhandledEvents).toBe(metrics.totalEvents);
      expect(metrics.healthStatus).toBeDefined();
    });

    it('não deve ter eventos críticos sem handler', () => {
      const violations = validateCriticalEventsCoverage();
      expect(violations).toHaveLength(0);
    });

    it('assertCriticalEventsCovered não deve lançar erro', () => {
      expect(() => assertCriticalEventsCovered()).not.toThrow();
    });

    it('cobertura de categorias core deve ser >= 80%', () => {
      const metrics = calculateRegistryMetrics();
      const coreCategories = ['PAYMENT', 'SUBSCRIPTION', 'TRANSFER', 'ACCOUNT_STATUS'];

      for (const cat of coreCategories) {
        const catMetrics = metrics.byCategory[cat];
        expect(catMetrics, `Categoria ${cat} deve existir`).toBeDefined();
        expect(
          catMetrics.percentHandled,
          `Categoria ${cat} deve ter >= 80% handled (atual: ${catMetrics.percentHandled}%)`,
        ).toBeGreaterThanOrEqual(80);
      }
    });

    it('health status geral não deve ser CRITICAL', () => {
      const metrics = calculateRegistryMetrics();
      expect(metrics.healthStatus).not.toBe('CRITICAL');
    });
  });
});

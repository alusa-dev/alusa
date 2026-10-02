import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerTelemetrySink, type StructuredLog } from '@alusa/observability';
import { logFinanceOperationalEvent } from '../operational-log';

describe('logFinanceOperationalEvent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emite evento estável sem mensagem sensível do erro', () => {
    const records: StructuredLog[] = [];
    const unsubscribe = registerTelemetrySink({ log: (record) => records.push(record) });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      logFinanceOperationalEvent({
        severity: 'error',
        eventName: 'finance.webhook.transfer.processing.failed',
        error: new Error('Bearer private-token for conta-private and payment-private'),
      });

      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        severity: 'error',
        'service.name': 'alusa-finance',
        'event.name': 'finance.webhook.transfer.processing.failed',
        'error.type': 'Error',
      });
      expect(JSON.stringify(records)).not.toContain('private-token');
      expect(JSON.stringify(records)).not.toContain('conta-private');
      expect(JSON.stringify(records)).not.toContain('payment-private');
    } finally {
      unsubscribe();
    }
  });

  it('emite apenas a contagem agregada em resumo informativo', () => {
    const records: StructuredLog[] = [];
    const unsubscribe = registerTelemetrySink({ log: (record) => records.push(record) });
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    try {
      logFinanceOperationalEvent({
        severity: 'info',
        eventName: 'finance.webhook.dlq.requeued',
        itemCount: 3,
      });

      expect(consoleInfo).toHaveBeenCalledTimes(1);
      expect(records[0]).toMatchObject({
        severity: 'info',
        'event.name': 'finance.webhook.dlq.requeued',
        attributes: { itemCount: 3 },
      });
    } finally {
      unsubscribe();
    }
  });
});

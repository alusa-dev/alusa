import { describe, expect, it } from 'vitest';

import { inspectWebhookProcessingRuntimeStatus } from '../webhook-runtime-config';

describe('webhook runtime configuration', () => {
  it('mantém a produção assíncrona e sem drenagem inline', () => {
    const status = inspectWebhookProcessingRuntimeStatus({
      NODE_ENV: 'production',
      FIN_WEBHOOK_SYNC_OVERRIDE: 'false',
      FIN_WEBHOOK_INLINE_DRAIN: 'false',
    });

    expect(status.mode).toBe('QUEUE');
    expect(status.useAsyncQueue).toBe(true);
    expect(status.inlineDrain).toBe(false);
    expect(status.warnings).toHaveLength(0);
  });

  it('identifica explicitamente overrides perigosos em produção', () => {
    const status = inspectWebhookProcessingRuntimeStatus({
      NODE_ENV: 'production',
      FIN_WEBHOOK_SYNC_OVERRIDE: 'true',
      FIN_WEBHOOK_INLINE_DRAIN: 'true',
    });

    expect(status.mode).toBe('SYNC');
    expect(status.warnings.map((warning) => warning.code)).toEqual([
      'PRODUCTION_SYNC_OVERRIDE_ENABLED',
      'PRODUCTION_INLINE_DRAIN_ENABLED',
    ]);
  });
});

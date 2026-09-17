import { describe, expect, it, vi } from 'vitest';

import { logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';

describe('job observability', () => {
  it('registra apenas métricas numéricas do resultado', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    logJobResult(
      'example-job',
      Date.now() - 10,
      { processed: 3, failed: 1, results: [{ sensitive: 'value' }] },
      { dryRun: false },
    );

    expect(info).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(info.mock.calls[0]?.[0]));
    expect(payload).toMatchObject({
      type: 'job_completed',
      jobName: 'example-job',
      processed: 3,
      failed: 1,
      dryRun: false,
    });
    expect(payload.results).toBeUndefined();
    info.mockRestore();
  });

  it('não serializa a mensagem de erro para logs de falha desconhecida', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logJobFailure('example-job', Date.now(), { secret: 'not-logged' });

    const payload = JSON.parse(String(error.mock.calls[0]?.[0]));
    expect(payload).toMatchObject({
      type: 'job_failed',
      jobName: 'example-job',
      errorType: 'unknown_error',
    });
    expect(JSON.stringify(payload)).not.toContain('not-logged');
    error.mockRestore();
  });
});

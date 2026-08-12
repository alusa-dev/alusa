import { describe, expect, it } from 'vitest';

import {
  DOCUMENTS_READY_DELAY_MS,
  getDocumentsReadiness,
} from '../kyc-document-group-resolver';

describe('getDocumentsReadiness', () => {
  it('permite leitura quando não existe timestamp de provisionamento', () => {
    expect(getDocumentsReadiness(null)).toEqual({ ready: true, retryAfterMs: 0 });
  });

  it('bloqueia a leitura durante os primeiros 15 segundos', () => {
    const now = 1_000_000;
    const result = getDocumentsReadiness(new Date(now - 4_000), now);

    expect(result.ready).toBe(false);
    expect(result.retryAfterMs).toBe(DOCUMENTS_READY_DELAY_MS - 4_000);
  });

  it('permite leitura a partir do limite oficial', () => {
    const now = 1_000_000;
    expect(getDocumentsReadiness(new Date(now - DOCUMENTS_READY_DELAY_MS), now)).toEqual({
      ready: true,
      retryAfterMs: 0,
    });
  });
});

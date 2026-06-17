import { describe, expect, it } from 'vitest';

import { contaFiscalSettingsSchemaFingerprint } from '../fiscal-prisma';

describe('fiscal-prisma', () => {
  it('inclui campos fiscais recentes no fingerprint do schema', () => {
    const fingerprint = contaFiscalSettingsSchemaFingerprint();
    expect(fingerprint).toContain('stateInscription');
    expect(fingerprint).toContain('aedf');
    expect(fingerprint).toContain('useNationalPortal');
    expect(fingerprint).toContain('syncStatus');
  });
});

import { describe, expect, it } from 'vitest';

import { getKycActionLabel, getKycDocumentGuidance } from '@/features/kyc/document-guidance';

describe('kyc document guidance', () => {
  it('explica RG ou CNH para documentos de identificacao', () => {
    const guidance = getKycDocumentGuidance({
      documentType: 'IDENTIFICATION',
      uploadType: 'IDENTIFICATION',
    });

    expect(guidance.title).toContain('frente e o verso');
    expect(guidance.checklist.some((item) => item.includes('RG') || item.includes('CNH'))).toBe(true);
  });

  it('explica selfie para verificacao facial', () => {
    const guidance = getKycDocumentGuidance({
      documentType: 'IDENTIFICATION_SELFIE',
      uploadType: 'IDENTIFICATION_SELFIE',
    });

    expect(guidance.title).toContain('selfie');
    expect(guidance.checklist.some((item) => item.includes('rosto'))).toBe(true);
  });

  it('gera CTA mais especifica para upload de documento e selfie', () => {
    expect(
      getKycActionLabel({
        mode: 'UPLOAD',
        documentType: 'IDENTIFICATION',
        uploadType: 'IDENTIFICATION',
      }),
    ).toBe('Enviar frente e verso');

    expect(
      getKycActionLabel({
        mode: 'UPLOAD',
        documentType: 'IDENTIFICATION_SELFIE',
        uploadType: 'IDENTIFICATION_SELFIE',
      }),
    ).toBe('Enviar selfie');
  });

  it('mantem CTA de verificacao para fluxos externos', () => {
    expect(
      getKycActionLabel({
        mode: 'REDIRECT',
        documentType: 'IDENTIFICATION',
        uploadType: null,
      }),
    ).toBe('Continuar verificação');
  });
});

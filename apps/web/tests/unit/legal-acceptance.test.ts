import { describe, expect, it } from 'vitest';

import { authRegisterInputSchema } from '@/lib/dtos/auth-register.dto';
import { requiredRegisterLegalDocuments } from '@/lib/privacy/legal-versions';

describe('legal acceptance DTO', () => {
  it('exige aceite dos documentos atuais no cadastro inicial', () => {
    const result = authRegisterInputSchema.safeParse({
      escolaNome: 'Escola Alusa',
      nome: 'Admin Escola',
      email: 'admin@example.com',
      senha: 'SenhaFort3!',
      legalAcceptance: {
        accepted: true,
        locale: 'pt-BR',
        source: 'REGISTER',
        documents: requiredRegisterLegalDocuments().map((document) => ({
          documentType: document.type,
          documentVersion: document.version,
        })),
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejeita aceite ausente ou desatualizado', () => {
    const result = authRegisterInputSchema.safeParse({
      escolaNome: 'Escola Alusa',
      nome: 'Admin Escola',
      email: 'admin@example.com',
      senha: 'SenhaFort3!',
      legalAcceptance: {
        accepted: true,
        documents: [
          { documentType: 'TERMS_OF_USE', documentVersion: '2020-01-01' },
          { documentType: 'PRIVACY_POLICY', documentVersion: '2026-05-27' },
          { documentType: 'DPA', documentVersion: '2026-05-27' },
        ],
      },
    });

    expect(result.success).toBe(false);
  });
});

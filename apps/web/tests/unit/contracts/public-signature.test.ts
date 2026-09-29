import { describe, expect, it } from 'vitest';
import { buildSignaturePayload, isMaiorDeIdade } from '@alusa/domain';

describe('isMaiorDeIdade', () => {
  it('retorna true para 18+ no dia do aniversário', () => {
    const birthDate = new Date('2000-12-12T00:00:00.000Z');
    const referenceDate = new Date('2018-12-12T12:00:00.000Z');
    expect(isMaiorDeIdade(birthDate, referenceDate)).toBe(true);
  });

  it('retorna false para 17 anos', () => {
    const birthDate = new Date('2008-12-13T00:00:00.000Z');
    const referenceDate = new Date('2025-12-12T12:00:00.000Z');
    expect(isMaiorDeIdade(birthDate, referenceDate)).toBe(false);
  });

  it('considera que o aniversário ainda não chegou neste ano', () => {
    const birthDate = new Date(2007, 11, 13, 12);
    const referenceDate = new Date(2025, 11, 12, 12);
    expect(isMaiorDeIdade(birthDate, referenceDate)).toBe(false);
  });
});

describe('buildSignaturePayload', () => {
  it('gera um payload canônico e auditável', () => {
    const payload = buildSignaturePayload({
      contaId: 'conta-1',
      contratoId: 'contrato-1',
      matriculaId: 'matricula-1',
      hashPdf: 'abc123hash',
      cpf: '12345678901',
      nome: 'Fulano',
      email: '',
      dataNascimento: '2000-01-01',
      assinadoEmIso: '2025-12-12T12:00:00.000Z',
      ip: '127.0.0.1',
      userAgent: 'ua',
    });

    expect(payload).toEqual({
      v: 1,
      acceptanceText: expect.any(String),
      acceptanceVersion: 1,
      assinadoEm: '2025-12-12T12:00:00.000Z',
      contaId: 'conta-1',
      contratoId: 'contrato-1',
      cpf: '12345678901',
      dataNascimento: '2000-01-01',
      email: null,
      hashPdf: 'abc123hash',
      ip: '127.0.0.1',
      matriculaId: 'matricula-1',
      nome: 'Fulano',
      userAgent: 'ua',
      assinatura: null,
      consentimentos: [],
    });
  });
});

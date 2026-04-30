import { describe, expect, it } from 'vitest';
import { buildAssinaturaHashPayload, isMaiorDeIdade } from '@/app/api/public/contrato/[token]/assinar/route';

describe('isMaiorDeIdade', () => {
  it('retorna true para 18+ (mesmo mês/dia)', () => {
    const nasc = new Date('2000-12-12T00:00:00.000Z');
    const ref = new Date('2018-12-12T12:00:00.000Z');
    expect(isMaiorDeIdade(nasc, ref)).toBe(true);
  });

  it('retorna false para 17 anos', () => {
    const nasc = new Date('2008-12-13T00:00:00.000Z');
    const ref = new Date('2025-12-12T12:00:00.000Z');
    expect(isMaiorDeIdade(nasc, ref)).toBe(false);
  });

  it('lida com borda de aniversário (dia ainda não chegou)', () => {
    const nasc = new Date('2007-12-13T00:00:00.000Z');
    const ref = new Date('2025-12-12T12:00:00.000Z');
    expect(isMaiorDeIdade(nasc, ref)).toBe(false);
  });
});

describe('buildAssinaturaHashPayload', () => {
  it('gera payload canônico (auditável)', () => {
    const payload = buildAssinaturaHashPayload({
      contratoId: 'c1',
      hashPdf: 'abc123hash',
      cpf: '12345678901',
      nome: 'Fulano',
      email: '',
      assinadoEmIso: '2025-12-12T12:00:00.000Z',
      ip: '127.0.0.1',
      userAgent: 'ua',
    });

    expect(payload).toEqual({
      v: 1,
      contratoId: 'c1',
      assinadoEm: '2025-12-12T12:00:00.000Z',
      cpf: '12345678901',
      nome: 'Fulano',
      email: null,
      ip: '127.0.0.1',
      userAgent: 'ua',
      hashPdf: 'abc123hash',
    });
  });
});

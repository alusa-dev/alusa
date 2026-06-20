import { describe, expect, it } from 'vitest';

import {
  formatRematriculaFamiliarValidationMessage,
  rematriculaFamiliarPreviewInputSchema,
} from '@/lib/api/rematricula-familiar-input';

describe('rematriculaFamiliarPreviewInputSchema', () => {
  it('aceita campos opcionais vazios ou nulos e aplica defaults', () => {
    const parsed = rematriculaFamiliarPreviewInputSchema.parse({
      responsavelId: 'resp-1',
      itens: [
        {
          matriculaId: 'mat-1',
          turmaId: '',
          planoId: 'plano-1',
          comboId: null,
          decisionReason: null,
        },
        {
          matriculaId: 'mat-2',
          decision: 'NAO_CONTINUARA',
          turmaId: null,
          planoId: 'plano-1',
          comboId: null,
        },
      ],
      dataInicio: '2026-07-05T00:00:00.000Z',
      dataFimContrato: '2027-07-05T00:00:00.000Z',
      formaPagamento: 'CARTAO_CREDITO',
      formaPagamentoTaxa: null,
      vencimentoDia: '5',
      taxaJustificativa: null,
      contratoModeloId: null,
      uiRequestId: 'resp-1:1234567890',
    });

    expect(parsed.itens[0]?.decision).toBe('DECIDIR_DEPOIS');
    expect(parsed.itens[0]?.turmaId).toBeNull();
    expect(parsed.vencimentoDia).toBe(5);
    expect(parsed.taxaMatricula).toBe(0);
    expect(parsed.taxaIsenta).toBe(false);
  });

  it('formata mensagem amigável para decisão ausente', () => {
    const result = rematriculaFamiliarPreviewInputSchema.safeParse({
      responsavelId: 'resp-1',
      itens: [{ matriculaId: 'mat-1' }],
      dataInicio: '2026-07-05',
      dataFimContrato: '2027-07-05',
      formaPagamento: 'BOLETO',
      vencimentoDia: 5,
      uiRequestId: 'req',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.itens[0]?.decision).toBe('DECIDIR_DEPOIS');
    }
  });

  it('retorna mensagem orientativa para contrato inválido', () => {
    const result = rematriculaFamiliarPreviewInputSchema.safeParse({
      responsavelId: 'resp-1',
      itens: [{ matriculaId: 'mat-1', decision: 'REMATRICULAR_AGORA' }],
      dataInicio: '2026-07-05',
      dataFimContrato: '2027-07-05',
      formaPagamento: 'BOLETO',
      vencimentoDia: 5,
      contratoModeloId: '',
      uiRequestId: 'req',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contratoModeloId).toBeNull();
    }
  });
});

describe('formatRematriculaFamiliarValidationMessage', () => {
  it('orienta sobre vencimento inválido', () => {
    const message = formatRematriculaFamiliarValidationMessage([
      {
        code: 'too_big',
        maximum: 28,
        type: 'number',
        inclusive: true,
        exact: false,
        message: 'Number must be less than or equal to 28',
        path: ['vencimentoDia'],
      },
    ]);

    expect(message).toContain('vencimento');
  });
});

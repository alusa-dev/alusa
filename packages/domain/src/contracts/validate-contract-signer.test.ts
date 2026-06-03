import { describe, expect, it } from 'vitest';
import { validateContractSigner } from './validate-contract-signer.js';

describe('validateContractSigner', () => {
  const now = new Date('2026-06-01T12:00:00.000Z');

  it('permite responsável financeiro vinculado', () => {
    const result = validateContractSigner({
      cpf: '529.982.247-25',
      now,
      aluno: { nome: 'Aluno', cpf: '39053344705', dataNasc: '2015-01-01' },
      responsavelFinanceiro: { nome: 'Responsável', cpf: '52998224725' },
    });

    expect(result).toEqual({
      ok: true,
      signer: { type: 'RESPONSAVEL_FINANCEIRO', cpf: '52998224725', nome: 'Responsável' },
    });
  });

  it('permite aluno maior de idade', () => {
    const result = validateContractSigner({
      cpf: '390.533.447-05',
      now,
      aluno: { nome: 'Aluno Maior', cpf: '39053344705', dataNasc: '2000-01-01' },
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.signer.type).toBe('ALUNO_MAIOR');
  });

  it('rejeita aluno menor de idade', () => {
    const result = validateContractSigner({
      cpf: '390.533.447-05',
      now,
      aluno: { nome: 'Aluno Menor', cpf: '39053344705', dataNasc: '2015-01-01' },
    });

    expect(result).toEqual({
      ok: false,
      code: 'UNDERAGE_STUDENT',
      error: 'Aluno menor de idade não pode assinar o contrato.',
    });
  });

  it('rejeita CPF não vinculado', () => {
    const result = validateContractSigner({
      cpf: '390.533.447-05',
      now,
      aluno: { nome: 'Aluno', cpf: '52998224725', dataNasc: '2000-01-01' },
      responsavelFinanceiro: { nome: 'Responsável', cpf: '29537973816' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_AUTHORIZED');
  });
});

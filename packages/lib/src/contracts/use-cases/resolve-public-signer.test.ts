import { describe, expect, it } from 'vitest';
import { resolvePublicContractSigner } from './resolve-public-signer';

const adultBirthDate = '1990-01-01';
const minorBirthDate = '2015-01-01';

describe('resolvePublicContractSigner', () => {
  it('resolve o aluno maior e usa o e-mail cadastrado do aluno', () => {
    const result = resolvePublicContractSigner({
      cpf: '529.982.247-25',
      aluno: { cpf: '52998224725', nome: 'Aluno Maior', dataNasc: adultBirthDate, email: ' ALUNO@EXAMPLE.COM ' },
      now: new Date('2026-09-04'),
    });

    expect(result).toEqual({
      signer: { type: 'ALUNO_MAIOR', cpf: '52998224725', nome: 'Aluno Maior' },
      email: 'aluno@example.com',
    });
  });

  it('resolve o responsável legal apenas no vínculo da conta ativa', () => {
    const result = resolvePublicContractSigner({
      cpf: '11144477735',
      contaId: 'conta-1',
      aluno: { cpf: '52998224725', nome: 'Aluno Menor', dataNasc: minorBirthDate },
      responsaveis: [
        { cpf: '11144477735', nome: 'Outro Tenant', email: 'outro@example.com', contaId: 'conta-2' },
        { cpf: '11144477735', nome: 'Responsável Legal', email: ' LEGAL@EXAMPLE.COM ', contaId: 'conta-1' },
      ],
      now: new Date('2026-09-04'),
    });

    expect(result.signer.type).toBe('RESPONSAVEL_LEGAL');
    expect(result.email).toBe('legal@example.com');
  });

  it('recusa signatário sem e-mail cadastrado', () => {
    expect(() => resolvePublicContractSigner({
      cpf: '52998224725',
      aluno: { cpf: '52998224725', nome: 'Aluno Maior', dataNasc: adultBirthDate },
      now: new Date('2026-09-04'),
    })).toThrow('SIGNATURE_OTP_EMAIL_MISSING');
  });
});

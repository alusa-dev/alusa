import { normalizeCpf, parseCpf } from '../value-objects/cpf.js';

export type ContractSignerCandidate = {
  cpf: string | null | undefined;
  nome: string | null | undefined;
  dataNasc?: Date | string | null;
};

export type ValidateContractSignerInput = {
  cpf: string;
  aluno: ContractSignerCandidate;
  responsavelFinanceiro?: ContractSignerCandidate | null;
  now?: Date;
};

export type ValidateContractSignerResult =
  | {
      ok: true;
      signer: {
        type: 'RESPONSAVEL_FINANCEIRO' | 'ALUNO_MAIOR';
        cpf: string;
        nome: string;
      };
    }
  | { ok: false; error: string; code: 'INVALID_CPF' | 'UNDERAGE_STUDENT' | 'NOT_AUTHORIZED' | 'MISSING_BIRTHDATE' };

export function isMaiorDeIdade(dataNasc: Date | string, referencia = new Date()): boolean {
  const birthDate = dataNasc instanceof Date ? dataNasc : new Date(dataNasc);
  if (Number.isNaN(birthDate.getTime())) return false;

  const yearDiff = referencia.getFullYear() - birthDate.getFullYear();
  if (yearDiff > 18) return true;
  if (yearDiff < 18) return false;

  const monthDiff = referencia.getMonth() - birthDate.getMonth();
  if (monthDiff > 0) return true;
  if (monthDiff < 0) return false;

  return referencia.getDate() >= birthDate.getDate();
}

export function validateContractSigner(input: ValidateContractSignerInput): ValidateContractSignerResult {
  const parsedCpf = parseCpf(input.cpf);
  if (!parsedCpf.ok) {
    return { ok: false, code: 'INVALID_CPF', error: parsedCpf.error };
  }

  const cpf = parsedCpf.value;
  const responsavelCpf = input.responsavelFinanceiro?.cpf
    ? normalizeCpf(input.responsavelFinanceiro.cpf)
    : null;

  if (responsavelCpf && cpf === responsavelCpf) {
    const nome = input.responsavelFinanceiro?.nome?.trim();
    if (nome) return { ok: true, signer: { type: 'RESPONSAVEL_FINANCEIRO', cpf, nome } };
  }

  const alunoCpf = input.aluno.cpf ? normalizeCpf(input.aluno.cpf) : null;
  if (alunoCpf && cpf === alunoCpf) {
    if (!input.aluno.dataNasc) {
      return {
        ok: false,
        code: 'MISSING_BIRTHDATE',
        error: 'Não foi possível validar a maioridade do aluno.',
      };
    }

    if (!isMaiorDeIdade(input.aluno.dataNasc, input.now)) {
      return {
        ok: false,
        code: 'UNDERAGE_STUDENT',
        error: 'Aluno menor de idade não pode assinar o contrato.',
      };
    }

    const nome = input.aluno.nome?.trim();
    if (nome) return { ok: true, signer: { type: 'ALUNO_MAIOR', cpf, nome } };
  }

  return {
    ok: false,
    code: 'NOT_AUTHORIZED',
    error: 'CPF não corresponde ao responsável ou aluno maior de idade autorizado.',
  };
}

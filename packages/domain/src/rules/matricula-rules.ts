/**
 * Regras de negócio de matrícula
 */

export function calcularIdadeMinima(): number {
  return 3;
}

export function calcularIdadeMaxima(): number {
  return 99;
}

/**
 * Calcula idade a partir de uma data de nascimento
 */
export function calcularIdade(dataNasc: Date): number {
  const hoje = new Date();
  let idade = hoje.getFullYear() - dataNasc.getFullYear();
  const m = hoje.getMonth() - dataNasc.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < dataNasc.getDate())) {
    idade--;
  }
  return idade;
}

/**
 * Verifica se o aluno é menor de idade (< 18 anos)
 */
export function isMenorDeIdade(dataNasc: Date): boolean {
  return calcularIdade(dataNasc) < 18;
}

/**
 * Determina se é necessário um responsável financeiro
 * @deprecated Use `isMenorDeIdade` para clareza
 */
export function precisaResponsavelFinanceiro(idadeAluno: number): boolean {
  return idadeAluno < 18;
}

// ============================================================================
// RESOLVE PAYER — Função canônica para determinar o pagador
// ============================================================================

export type PayerType = 'ALUNO' | 'RESPONSAVEL';

export type PayerRef = {
  type: PayerType;
  id: string;
};

export type ResolvePayerInput = {
  alunoId: string;
  alunoDataNasc: Date;
  responsavelFinanceiroId?: string | null;
};

export type ResolvePayerResult =
  | { success: true; payer: PayerRef }
  | { success: false; error: 'RESPONSAVEL_OBRIGATORIO_MENOR' | 'ALUNO_SEM_ID' };

/**
 * Função canônica para determinar quem é o pagador.
 * 
 * Regra de negócio (Single Source of Truth):
 * - Aluno >= 18 anos → o próprio aluno é o pagador
 * - Aluno < 18 anos → responsável financeiro é obrigatório
 * 
 * Esta função deve ser usada por TODOS os fluxos que precisam
 * determinar o pagador: matrícula, cobrança, assinatura, parcelamento.
 */
export function resolvePayer(input: ResolvePayerInput): ResolvePayerResult {
  const menor = isMenorDeIdade(input.alunoDataNasc);

  if (menor) {
    // Menor de idade: responsável financeiro é obrigatório
    if (!input.responsavelFinanceiroId) {
      return { success: false, error: 'RESPONSAVEL_OBRIGATORIO_MENOR' };
    }
    return {
      success: true,
      payer: { type: 'RESPONSAVEL', id: input.responsavelFinanceiroId },
    };
  }

  // Maior de idade: verifica se há responsável explícito
  if (input.responsavelFinanceiroId) {
    return {
      success: true,
      payer: { type: 'RESPONSAVEL', id: input.responsavelFinanceiroId },
    };
  }

  // Maior de idade e sem responsável: o próprio aluno é o pagador
  if (!input.alunoId) {
    return { success: false, error: 'ALUNO_SEM_ID' };
  }
  return {
    success: true,
    payer: { type: 'ALUNO', id: input.alunoId },
  };
}

export function valorMinimoMensalidade(): number {
  return 10.0;
}

export function descontoMaximoPermitido(): number {
  return 100.0;
}

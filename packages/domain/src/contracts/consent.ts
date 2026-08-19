export const CONTRACT_CONSENT_DECISIONS = ['AUTORIZADO', 'RECUSADO'] as const;

export type ContractConsentDecision = (typeof CONTRACT_CONSENT_DECISIONS)[number];

export type ContractConsentTermSnapshot = {
  id: string;
  codigo: string;
  finalidade: string;
  titulo: string;
  texto: string;
  papel: 'RESPONSAVEL_OU_ALUNO';
  obrigatorio: boolean;
  recusaImpedeAssinatura: boolean;
  ordem: number;
  templateId?: string | null;
  templateVersao?: number | null;
  contexto?: ContractConsentRenderContext | null;
};

export type ContractConsentSignerType = 'ALUNO_MAIOR' | 'RESPONSAVEL';

export type ContractConsentRenderContext = {
  signerType: ContractConsentSignerType;
  signerName: string;
  signerCpf?: string | null;
  studentName: string;
  studentCpf?: string | null;
  relationship?: string | null;
};

export function renderContractConsentTemplate(
  template: string,
  context: ContractConsentRenderContext,
) {
  const variables: Record<string, string> = {
    nome_assinante: context.signerName,
    cpf_assinante: context.signerCpf ?? '',
    nome_aluno: context.studentName,
    cpf_aluno: context.studentCpf ?? '',
    tipo_assinante: context.signerType === 'ALUNO_MAIOR' ? 'aluno maior de idade' : 'responsável legal',
    relacao_com_aluno: context.relationship ?? 'responsável legal',
    qualificacao_assinante: context.signerType === 'ALUNO_MAIOR'
      ? 'na condição de titular da própria imagem'
      : `na qualidade de ${context.relationship || 'responsável legal'} de ${context.studentName}`,
  };

  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => variables[key] ?? '');
}

export type ContractConsentAnswer = {
  termId: string;
  decision: ContractConsentDecision;
};

export type ResolvedContractConsent = ContractConsentTermSnapshot & {
  decision: ContractConsentDecision;
};

export function snapshotContractConsentTerms(
  terms: Array<{
    id: string;
    codigo: string;
    finalidade: string;
    titulo: string;
    texto: string;
    papel: string;
    obrigatorio: boolean;
    recusaImpedeAssinatura: boolean;
    ordem: number;
    templateId?: string | null;
    templateVersao?: number | null;
    contexto?: ContractConsentRenderContext | null;
  }>,
  context?: ContractConsentRenderContext | null,
): ContractConsentTermSnapshot[] {
  return terms
    .slice()
    .sort((a, b) => a.ordem - b.ordem || a.id.localeCompare(b.id))
    .map((term) => {
      const renderContext = context ?? term.contexto ?? null;
      return {
        id: term.id,
        codigo: term.codigo,
        finalidade: term.finalidade,
        titulo: term.titulo,
        texto: renderContext ? renderContractConsentTemplate(term.texto, renderContext) : term.texto,
        papel: 'RESPONSAVEL_OU_ALUNO' as const,
        obrigatorio: term.obrigatorio,
        recusaImpedeAssinatura: term.recusaImpedeAssinatura,
        ordem: term.ordem,
        templateId: term.templateId ?? null,
        templateVersao: term.templateVersao ?? null,
        contexto: renderContext,
      };
    });
}

export function resolveContractConsentAnswers(
  terms: ContractConsentTermSnapshot[],
  answers: ContractConsentAnswer[] = [],
): ResolvedContractConsent[] {
  const answerMap = new Map<string, ContractConsentDecision>();

  for (const answer of answers) {
    if (answerMap.has(answer.termId)) {
      throw new Error('CONTRACT_CONSENT_DUPLICATE');
    }
    if (!CONTRACT_CONSENT_DECISIONS.includes(answer.decision)) {
      throw new Error('CONTRACT_CONSENT_INVALID_DECISION');
    }
    answerMap.set(answer.termId, answer.decision);
  }

  for (const answer of answers) {
    if (!terms.some((term) => term.id === answer.termId)) {
      throw new Error('CONTRACT_CONSENT_UNKNOWN_TERM');
    }
  }

  const resolved: ResolvedContractConsent[] = [];
  for (const term of terms) {
    const decision = answerMap.get(term.id);
    if (!decision && term.obrigatorio) {
      throw new Error('CONTRACT_CONSENT_REQUIRED');
    }

    if (!decision) {
      continue;
    }

    resolved.push({ ...term, decision });
  }

  return resolved;
}

export function buildContractConsentPayload(
  resolved: ResolvedContractConsent[],
) {
  return resolved
    .slice()
    .sort((a, b) => a.ordem - b.ordem || a.id.localeCompare(b.id))
    .map(({ id, codigo, finalidade, titulo, texto, papel, obrigatorio, recusaImpedeAssinatura, ordem, decision }) => ({
      id,
      codigo,
      finalidade,
      titulo,
      texto,
      papel,
      obrigatorio,
      recusaImpedeAssinatura,
      ordem,
      decision,
    }));
}

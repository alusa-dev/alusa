export type AulasErrorCode =
  | 'EVENTO_NAO_ENCONTRADO'
  | 'TURMA_NAO_ENCONTRADA'
  | 'REPOSICAO_NAO_ENCONTRADA'
  | 'CONFLITO_SALA_PROFESSOR'
  | 'FREQUENCIA_DIA_INVALIDO'
  | 'FREQUENCIA_FORA_DA_JANELA'
  | 'ALUNO_NAO_ELEGIVEL'
  | 'REPOSICAO_INDIVIDUAL_SEM_ALUNO'
  | 'TURMA_ORIGEM_DESTINO_INVALIDA'
  | 'EVENTO_DESTINO_OBRIGATORIO'
  | 'PROFESSOR_NAO_VINCULADO'
  | 'OPERACAO_NAO_PERMITIDA';

const STATUS_MAP: Record<AulasErrorCode, number> = {
  EVENTO_NAO_ENCONTRADO: 404,
  TURMA_NAO_ENCONTRADA: 404,
  REPOSICAO_NAO_ENCONTRADA: 404,
  CONFLITO_SALA_PROFESSOR: 409,
  FREQUENCIA_DIA_INVALIDO: 422,
  FREQUENCIA_FORA_DA_JANELA: 422,
  ALUNO_NAO_ELEGIVEL: 422,
  REPOSICAO_INDIVIDUAL_SEM_ALUNO: 422,
  TURMA_ORIGEM_DESTINO_INVALIDA: 422,
  EVENTO_DESTINO_OBRIGATORIO: 422,
  PROFESSOR_NAO_VINCULADO: 403,
  OPERACAO_NAO_PERMITIDA: 403,
};

export class AulasError extends Error {
  readonly code: AulasErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: AulasErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AulasError';
    this.code = code;
    this.statusCode = STATUS_MAP[code];
    this.details = details;
  }
}

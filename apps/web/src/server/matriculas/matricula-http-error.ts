import {
  MatriculaRuleError,
  type MatriculaRuleErrorCode,
} from './matricula.service';

export type MatriculaRuleHttpError = {
  status: 404 | 409 | 422;
  code: MatriculaRuleErrorCode;
  message: string;
};

/**
 * Converte erros semânticos de matrícula no contrato HTTP público.
 *
 * O detalhe da regra fica restrito ao log do servidor; consumidores dependem
 * do código estável e não de mensagens internas ou stack traces.
 */
export function mapMatriculaRuleError(error: unknown): MatriculaRuleHttpError | null {
  if (!(error instanceof MatriculaRuleError)) return null;

  switch (error.code) {
    case 'MATRICULA_NAO_ENCONTRADA':
      return {
        status: 404,
        code: error.code,
        message: 'Matrícula não encontrada.',
      };
    case 'MATRICULA_STATUS_TERMINAL':
      return {
        status: 409,
        code: error.code,
        message: 'A matrícula está em um estado terminal e não pode ser alterada.',
      };
    case 'TRANSICAO_STATUS_INVALIDA':
      return {
        status: 422,
        code: error.code,
        message: 'A transição de status solicitada não é permitida.',
      };
    case 'MATRICULA_NAO_EDITAVEL':
      return {
        status: 409,
        code: error.code,
        message: 'A matrícula não pode ser editada neste estado.',
      };
    case 'DATA_FIM_INVALIDA':
      return {
        status: 422,
        code: error.code,
        message: 'A data de fim do contrato deve ser posterior à data de início.',
      };
    case 'DATA_INICIO_INVALIDA':
      return {
        status: 422,
        code: error.code,
        message: 'A data de início do contrato não pode estar no passado.',
      };
    default:
      return null;
  }
}

import {
  matriculaReenviarCobrancaResultDTOSchema,
  type MatriculaReenviarCobrancaResultDTO,
  type MatriculaResumoDTO,
} from '../dtos';
import { matriculaResumoDTOSchema } from '../dtos';

export type PaymentLinksResponse = MatriculaReenviarCobrancaResultDTO;

async function parseResponse<T>(
  res: Response,
  parser: { parse: (_value: unknown) => T },
  fallback: string,
) {
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (json as { error?: { message?: string } } | { error?: string } | null)?.error &&
        typeof (json as { error?: unknown }).error === 'string'
        ? String((json as { error?: string }).error)
        : (json as { error?: { message?: string } } | null)?.error?.message || fallback,
    );
  }
  return parser.parse(json);
}

export async function reenviarCobrancaMatricula(
  matriculaId: string,
): Promise<PaymentLinksResponse> {
  const res = await fetch(`/api/matriculas/${matriculaId}/reenviar-cobranca`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  return parseResponse(
    res,
    matriculaReenviarCobrancaResultDTOSchema,
    'Falha ao reenviar cobrança',
  );
}

export async function getMatriculaDetalhes(
  matriculaId: string,
): Promise<{ matricula: MatriculaResumoDTO }> {
  const res = await fetch(`/api/matriculas/${matriculaId}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  return parseResponse(
    res,
    {
      parse(value: unknown) {
        const payload = value as { matricula?: unknown };
        return {
          matricula: matriculaResumoDTOSchema.parse(payload.matricula),
        };
      },
    },
    'Falha ao buscar detalhes',
  );
}

import {
  alunoContratoCardDTOSchema,
  contratoDTOSchema,
  createContratoInputDTOSchema,
  deleteContratoResultDTOSchema,
  listAlunosComContratosResultDTOSchema,
  listContratosResultDTOSchema,
  type AlunoContratoCardDTO,
  type ContratoDTO,
  type ContratoStatusDTO,
  type CreateContratoInputDTO,
} from '../dtos';

export type Contrato = ContratoDTO;
export type CreateContratoPayload = CreateContratoInputDTO;
export type ContratoStatus = ContratoStatusDTO;
export type AlunoContratoCard = AlunoContratoCardDTO;

export function getContratoPdfUrl(contrato: Pick<Contrato, 'arquivoPdfUrl' | 'arquivoPdfAssinadoUrl'>) {
  return contrato.arquivoPdfAssinadoUrl || contrato.arquivoPdfUrl;
}

async function parseResponse<T>(res: Response, parser: { parse: (_value: unknown) => T }, fallback: string) {
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (json as { error?: { message?: string } } | null)?.error?.message || fallback,
    );
  }
  return parser.parse(json);
}

export async function getContratos(matriculaId?: string, status?: string): Promise<Contrato[]> {
  const params = new URLSearchParams();
  if (matriculaId) params.append('matriculaId', matriculaId);
  if (status) params.append('status', status);

  const res = await fetch(`/api/contratos?${params.toString()}`);
  return parseResponse(res, listContratosResultDTOSchema, 'Erro ao carregar contratos');
}

export async function getContrato(id: string): Promise<Contrato> {
  const res = await fetch(`/api/contratos/${id}`);
  return parseResponse(res, contratoDTOSchema, 'Erro ao carregar contrato');
}

export async function createContrato(payload: CreateContratoPayload): Promise<Contrato> {
  const body = createContratoInputDTOSchema.parse(payload);
  const res = await fetch('/api/contratos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return parseResponse(res, contratoDTOSchema, 'Erro ao gerar contrato');
}

export async function cancelContrato(id: string): Promise<void> {
  const res = await fetch(`/api/contratos/${id}`, {
    method: 'DELETE',
  });

  await parseResponse(res, deleteContratoResultDTOSchema, 'Erro ao cancelar contrato');
}

export async function regenerateContrato(id: string): Promise<Contrato> {
  const res = await fetch(`/api/contratos/${id}/regenerar`, {
    method: 'PATCH',
  });

  return parseResponse(res, contratoDTOSchema, 'Erro ao regenerar link do contrato');
}

export async function getContratosByAluno(
  alunoId: string,
  status?: ContratoStatus,
): Promise<Contrato[]> {
  const params = new URLSearchParams();
  params.set('alunoId', alunoId);
  if (status) params.set('status', status);

  const res = await fetch(`/api/contratos?${params.toString()}`);
  return parseResponse(res, listContratosResultDTOSchema, 'Erro ao carregar contratos');
}

export interface ListAlunosComContratosParams {
  q?: string;
  status?: ContratoStatus;
  turmaId?: string;
}

export async function listAlunosComContratos(
  params: ListAlunosComContratosParams,
  signal?: AbortSignal,
): Promise<AlunoContratoCard[]> {
  const qs = new URLSearchParams();
  if (params.q && params.q.trim()) qs.set('q', params.q.trim());
  if (params.status) qs.set('status', params.status);
  if (params.turmaId) qs.set('turmaId', params.turmaId);

  const res = await fetch(`/api/contratos/alunos?${qs.toString()}`, { signal });
  return parseResponse(
    res,
    listAlunosComContratosResultDTOSchema,
    'Erro ao carregar alunos com contratos',
  );
}

export function parseAlunoContratoCard(raw: unknown): AlunoContratoCard {
  return alunoContratoCardDTOSchema.parse(raw);
}

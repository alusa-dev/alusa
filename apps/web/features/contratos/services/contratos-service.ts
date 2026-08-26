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
  type ListAlunosComContratosResultDTO,
} from '../dtos';

export type Contrato = ContratoDTO;
export type CreateContratoPayload = CreateContratoInputDTO;
export type ContratoStatus = ContratoStatusDTO;
export type AlunoContratoCard = AlunoContratoCardDTO;
export type AlunosComContratosPage = ListAlunosComContratosResultDTO;

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

export type EventoContrato = {
  id: string;
  origin: 'EVENT';
  eventId: string;
  alunoId: string;
  aluno: { id: string; nome: string; cpf: string | null } | null;
  responsavel: { id: string; nome: string; cpf: string } | null;
  evento: { id: string; name: string; startsAt: string } | null;
  modelo: { id: string; nome: string; versao: number } | null;
  status: string;
  assinadoPor: string | null;
  assinadoCpf: string | null;
  assinadoEm: string | null;
  hashAssinatura: string | null;
  tokenPublico: string;
  arquivoPdfUrl: string;
  arquivoPdfAssinadoUrl: string | null;
  tokenExpiraEm: string | null;
  createdAt: string;
};

export async function getEventContractsByAluno(alunoId: string): Promise<EventoContrato[]> {
  const res = await fetch(`/api/event-contracts?alunoId=${encodeURIComponent(alunoId)}`, { cache: 'no-store' });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error?.message ?? 'Erro ao carregar contratos de eventos');
  return (json?.data ?? []) as EventoContrato[];
}

export async function getEventContract(id: string): Promise<EventoContrato> {
  const res = await fetch(`/api/event-contracts/${encodeURIComponent(id)}`, { cache: 'no-store' });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error?.message ?? 'Erro ao carregar contrato de evento');
  return json.data as EventoContrato;
}

export async function regenerateEventContract(id: string): Promise<EventoContrato> {
  const res = await fetch(`/api/event-contracts/${encodeURIComponent(id)}/regenerar`, { method: 'PATCH' });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error?.message ?? 'Erro ao gerar link do contrato de evento');
  return json.data as EventoContrato;
}

export interface ListAlunosComContratosParams {
  q?: string;
  status?: ContratoStatus;
  turmaId?: string;
  page?: number;
}

export async function listAlunosComContratos(
  params: ListAlunosComContratosParams,
  signal?: AbortSignal,
): Promise<AlunosComContratosPage> {
  const qs = new URLSearchParams();
  if (params.q && params.q.trim()) qs.set('q', params.q.trim());
  if (params.status) qs.set('status', params.status);
  if (params.turmaId) qs.set('turmaId', params.turmaId);
  if (params.page && params.page > 1) qs.set('page', String(params.page));

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

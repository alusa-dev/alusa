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

export type Contract = ContratoDTO;
export type CreateContractPayload = CreateContratoInputDTO;
export type ContractStatus = ContratoStatusDTO;
export type ContractWhatsAppNotification = {
  id: string;
  status: string;
  templateName: string;
  languageCode: string;
  recipientPhone: string;
  recipientType: string;
  attempts: number;
  lastErrorCode: string | null;
  lastError: string | null;
  whatsappJobId: string | null;
  createdAt: string;
  processedAt: string | null;
};
export type StudentContractCard = AlunoContratoCardDTO;
export type StudentsWithContractsPage = ListAlunosComContratosResultDTO;

export function getContractPdfUrl(contrato: Pick<Contract, 'arquivoPdfUrl' | 'arquivoPdfAssinadoUrl'>) {
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

export async function getContracts(matriculaId?: string, status?: string): Promise<Contract[]> {
  const params = new URLSearchParams();
  if (matriculaId) params.append('matriculaId', matriculaId);
  if (status) params.append('status', status);

  const res = await fetch(`/api/contratos?${params.toString()}`);
  return parseResponse(res, listContratosResultDTOSchema, 'Erro ao carregar contratos');
}

export async function getContract(id: string): Promise<Contract> {
  const res = await fetch(`/api/contratos/${id}`);
  return parseResponse(res, contratoDTOSchema, 'Erro ao carregar contrato');
}

export async function createContract(payload: CreateContractPayload): Promise<Contract> {
  const body = createContratoInputDTOSchema.parse(payload);
  const res = await fetch('/api/contratos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return parseResponse(res, contratoDTOSchema, 'Erro ao gerar contrato');
}

export async function cancelContract(id: string): Promise<void> {
  const res = await fetch(`/api/contratos/${id}`, {
    method: 'DELETE',
  });

  await parseResponse(res, deleteContratoResultDTOSchema, 'Erro ao cancelar contrato');
}

export async function regenerateContract(id: string): Promise<Contract> {
  const res = await fetch(`/api/contratos/${id}/regenerar`, {
    method: 'PATCH',
  });

  return parseResponse(res, contratoDTOSchema, 'Erro ao regenerar link do contrato');
}

export async function getContractWhatsAppNotification(id: string): Promise<ContractWhatsAppNotification | null> {
  const res = await fetch(`/api/comunicacao/whatsapp/contratos/${encodeURIComponent(id)}/template`, { cache: 'no-store' });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? 'Erro ao consultar comunicação WhatsApp');
  return (json?.notification ?? null) as ContractWhatsAppNotification | null;
}

export async function retryContractWhatsAppNotification(id: string) {
  const res = await fetch(`/api/comunicacao/whatsapp/contratos/${encodeURIComponent(id)}/template`, { method: 'POST' });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? 'Erro ao reenviar comunicação WhatsApp');
  return json as {
    success: true;
    notificationId: string;
    notification: { deadLettered: number; retried: number; queued: number };
    outbox: { deadLettered: number; retried: number; sent: number };
  };
}

export async function getContractsByStudent(
  alunoId: string,
  status?: ContractStatus,
): Promise<Contract[]> {
  const params = new URLSearchParams();
  params.set('alunoId', alunoId);
  if (status) params.set('status', status);

  const res = await fetch(`/api/contratos?${params.toString()}`);
  return parseResponse(res, listContratosResultDTOSchema, 'Erro ao carregar contratos');
}

export type ContractEvent = {
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

export async function getEventContractsByStudent(alunoId: string): Promise<ContractEvent[]> {
  const res = await fetch(`/api/event-contracts?alunoId=${encodeURIComponent(alunoId)}`, { cache: 'no-store' });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error?.message ?? 'Erro ao carregar contratos de eventos');
  return (json?.data ?? []) as ContractEvent[];
}

export async function getEventContract(id: string): Promise<ContractEvent> {
  const res = await fetch(`/api/event-contracts/${encodeURIComponent(id)}`, { cache: 'no-store' });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error?.message ?? 'Erro ao carregar contrato de evento');
  return json.data as ContractEvent;
}

export async function regenerateEventContract(id: string): Promise<ContractEvent> {
  const res = await fetch(`/api/event-contracts/${encodeURIComponent(id)}/regenerar`, { method: 'PATCH' });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error?.message ?? 'Erro ao gerar link do contrato de evento');
  return json.data as ContractEvent;
}

export interface ListStudentsWithContractsParams {
  q?: string;
  status?: ContractStatus;
  turmaId?: string;
  page?: number;
}

export async function listStudentsWithContracts(
  params: ListStudentsWithContractsParams,
  signal?: AbortSignal,
): Promise<StudentsWithContractsPage> {
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

export function parseStudentContractCard(raw: unknown): StudentContractCard {
  return alunoContratoCardDTOSchema.parse(raw);
}

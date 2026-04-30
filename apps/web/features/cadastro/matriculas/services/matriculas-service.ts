import {
  createMatriculaInputDTOSchema,
  createMatriculaResultDTOSchema,
  listMatriculasResultDTOSchema,
  matriculaPausaResumoDTOSchema,
  matriculaCobrancaStatusDTOSchema,
  matriculaStatusSyncResultDTOSchema,
  matriculaTaxaStatusDTOSchema,
  pausarMatriculaInputDTOSchema,
  pausarMatriculaResultDTOSchema,
  reativarMatriculaInputDTOSchema,
  reativarMatriculaResultDTOSchema,
  updateMatriculaResultDTOSchema,
  type CreateMatriculaInputDTO,
  type CreateMatriculaResultDTO,
  type MatriculaCobrancaStatusDTO,
  type MatriculaFormaPagamentoDTO,
  type MatriculaPausaResumoDTO,
  type MatriculaResumoDTO,
  type MatriculaStatusDTO,
  type MatriculaStatusSyncDataDTO,
  type MatriculaStatusSyncResultDTO,
  type MatriculaTaxaStatusDTO,
  type MatriculaTipoCobrancaDTO,
  type PausarMatriculaInputDTO,
  type PausarMatriculaResultDTO,
  type ReativarMatriculaInputDTO,
  type ReativarMatriculaResultDTO,
} from '../dtos';

export type MatriculaStatus = MatriculaStatusDTO;
export type StatusAssinatura = MatriculaResumoDTO['contratos'][number]['status'];
export type MatriculaCobrancaStatus = MatriculaCobrancaStatusDTO;
export type MatriculaFormaPagamento = MatriculaFormaPagamentoDTO;
export type MatriculaTaxaStatus = MatriculaTaxaStatusDTO;
export type MatriculaTipoCobranca = MatriculaTipoCobrancaDTO;
export type MatriculaListItem = MatriculaResumoDTO;
export type CreateMatriculaInput = CreateMatriculaInputDTO;
export type MatriculaCreatedPayload = CreateMatriculaResultDTO;
export type MatriculaStatusSyncData = MatriculaStatusSyncDataDTO;
export type MatriculaStatusSyncResponse = MatriculaStatusSyncResultDTO;
export type MatriculaCobrancaPayload = NonNullable<MatriculaCreatedPayload['cobrancas']['taxa']>;
export type MatriculaPausaResumo = MatriculaPausaResumoDTO;
export type PausarMatriculaInput = PausarMatriculaInputDTO;
export type ReativarMatriculaInput = ReativarMatriculaInputDTO;
export type PausarMatriculaResponse = PausarMatriculaResultDTO;
export type ReativarMatriculaResponse = ReativarMatriculaResultDTO;

export type MatriculaStatusAsaasAction = 'SUSPEND' | 'ACTIVATE' | 'DELETE' | 'LOCAL_ONLY' | 'NONE';

export interface PaymentSyncDetail {
  cobrancaId: string;
  asaasPaymentId: string | null;
  novoStatus: MatriculaCobrancaStatus;
  source: 'ASAAS' | 'LOCAL';
}

export interface PaymentSyncInfo {
  totalFromAsaas: number;
  matched: number;
  updated: number;
  warnings: string[];
  expectedWebhooks: string[];
  details: PaymentSyncDetail[];
}

export interface ResendCobrancaData {
  cobrancaId: string;
  matriculaId: string;
  status: MatriculaCobrancaStatus;
  previousStatus: MatriculaCobrancaStatus;
  newTaxaStatus: MatriculaTaxaStatus | null;
  invoiceUrl: string | null;
  bankSlipUrl: string | null;
  pixQrCodeUrl: string | null;
  pixCopyPaste: string | null;
}

export interface ResendCobrancaResponse {
  success: boolean;
  message: string;
  data: ResendCobrancaData;
}

export interface ListMatriculasParams {
  contaId: string;
  status?: MatriculaStatus | MatriculaStatus[];
  excludeStatus?: MatriculaStatus | MatriculaStatus[];
  search?: string;
  turmaId?: string;
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
}

interface ListMatriculasResponse {
  data: MatriculaListItem[];
  total: number;
  page: number;
  pageSize: number;
}

function normalizeStatusArray(status?: MatriculaStatus | MatriculaStatus[]) {
  if (!status) return [];
  if (Array.isArray(status)) return status;
  return [status];
}

function normalizePixQrCodeUrl(value: unknown): string | null {
  if (!value) return null;
  const url = String(value).trim();
  if (!url.length) return null;
  if (url.startsWith('data:image/')) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `data:image/png;base64,${url}`;
}

function isMatriculaCobrancaStatus(value: unknown): value is MatriculaCobrancaStatus {
  return matriculaCobrancaStatusDTOSchema.safeParse(value).success;
}

function isMatriculaTaxaStatus(value: unknown): value is MatriculaTaxaStatus {
  return matriculaTaxaStatusDTOSchema.safeParse(value).success;
}

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

export async function listMatriculasRequest(
  params: ListMatriculasParams,
): Promise<ListMatriculasResponse> {
  const usp = new URLSearchParams({ contaId: params.contaId });
  const statuses = normalizeStatusArray(params.status);
  const excludeStatuses = normalizeStatusArray(params.excludeStatus);
  if (statuses.length) usp.set('status', statuses.join(','));
  if (excludeStatuses.length) usp.set('excludeStatus', excludeStatuses.join(','));
  if (params.search) usp.set('q', params.search);
  if (params.turmaId) usp.set('turmaId', params.turmaId);
  if (params.page) usp.set('page', String(params.page));
  if (params.pageSize) usp.set('pageSize', String(params.pageSize));

  const res = await fetch(`/api/matriculas?${usp.toString()}`, {
    headers: { Accept: 'application/json' },
    signal: params.signal,
  });

  const payload = await parseResponse(
    res,
    listMatriculasResultDTOSchema,
    'Falha ao carregar matrículas.',
  );

  return {
    data: payload.matriculas,
    total: payload.total,
    page: payload.page,
    pageSize: payload.perPage,
  };
}

export async function createMatriculaRequest(
  input: CreateMatriculaInput,
): Promise<MatriculaCreatedPayload> {
  const body = createMatriculaInputDTOSchema.parse(input);
  const res = await fetch('/api/matriculas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });

  return parseResponse(res, createMatriculaResultDTOSchema, 'Não foi possível criar a matrícula.');
}

export async function atualizarStatusMatriculaRequest(input: {
  id: string;
  contaId: string;
  status: MatriculaStatus;
  dataFim?: string | null;
}) {
  const res = await fetch(`/api/matriculas/${input.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      contaId: input.contaId,
      status: input.status,
      dataFim: input.dataFim ?? undefined,
    }),
  });

  return parseResponse(
    res,
    updateMatriculaResultDTOSchema,
    'Não foi possível atualizar a matrícula.',
  );
}

export async function cancelarMatriculaRequest(input: { id: string; contaId: string }) {
  const usp = new URLSearchParams({ contaId: input.contaId });
  const res = await fetch(`/api/matriculas/${input.id}?${usp.toString()}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(
      (json as { error?: { message?: string } } | null)?.error?.message ||
        'Não foi possível cancelar a matrícula.',
    );
  }
}

export async function updateMatriculaStatusRequest(input: {
  id: string;
  status: 'ATIVA' | 'PAUSADA' | 'CANCELADA';
}): Promise<MatriculaStatusSyncResponse> {
  if (input.status !== 'CANCELADA') {
    throw new Error('Pausa e reativação devem usar os endpoints específicos da matrícula.');
  }

  const res = await fetch(`/api/matriculas/${input.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ status: input.status }),
  });

  return parseResponse(
    res,
    matriculaStatusSyncResultDTOSchema,
    'Não foi possível atualizar o status.',
  );
}

export async function pauseMatriculaRequest(input: {
  id: string;
  payload: PausarMatriculaInput;
}): Promise<PausarMatriculaResponse> {
  const body = pausarMatriculaInputDTOSchema.parse(input.payload);
  const res = await fetch(`/api/matriculas/${input.id}/pausar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });

  return parseResponse(
    res,
    pausarMatriculaResultDTOSchema,
    'Não foi possível pausar a matrícula.',
  );
}

export async function reactivateMatriculaRequest(input: {
  id: string;
  payload: ReativarMatriculaInput;
}): Promise<ReativarMatriculaResponse> {
  const body = reativarMatriculaInputDTOSchema.parse(input.payload);
  const res = await fetch(`/api/matriculas/${input.id}/reativar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });

  return parseResponse(
    res,
    reativarMatriculaResultDTOSchema,
    'Não foi possível reativar a matrícula.',
  );
}

export async function getMatriculaPausaResumoRequest(id: string): Promise<MatriculaPausaResumo> {
  const res = await fetch(`/api/matriculas/${id}/pausa-resumo`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });

  return parseResponse(
    res,
    matriculaPausaResumoDTOSchema,
    'Não foi possível carregar o resumo de pausa da matrícula.',
  );
}

export async function resendCobrancaRequest(cobrancaId: string): Promise<ResendCobrancaResponse> {
  const res = await fetch(`/api/cobrancas/${cobrancaId}/resend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(
      (json as { message?: string; error?: string } | null)?.message ||
        (json as { message?: string; error?: string } | null)?.error ||
        'Não foi possível reenviar a cobrança.',
    );
  }

  const payload = (json as {
    success?: boolean;
    message?: string;
    data?: Record<string, unknown>;
  }) ?? { success: true };

  const data = payload.data ?? {};

  return {
    success: payload.success !== false,
    message: payload.message ?? 'Cobrança reenviada com sucesso.',
    data: {
      cobrancaId: String(data.cobrancaId ?? cobrancaId),
      matriculaId: String(data.matriculaId ?? ''),
      status: isMatriculaCobrancaStatus(data.status) ? data.status : 'PENDENTE',
      previousStatus: isMatriculaCobrancaStatus(data.previousStatus)
        ? data.previousStatus
        : 'PENDENTE',
      newTaxaStatus: isMatriculaTaxaStatus(data.newTaxaStatus) ? data.newTaxaStatus : null,
      invoiceUrl: data.invoiceUrl ? String(data.invoiceUrl) : null,
      bankSlipUrl: data.bankSlipUrl ? String(data.bankSlipUrl) : null,
      pixQrCodeUrl: normalizePixQrCodeUrl(data.pixQrCodeUrl),
      pixCopyPaste: data.pixCopyPaste ? String(data.pixCopyPaste) : null,
    },
  };
}

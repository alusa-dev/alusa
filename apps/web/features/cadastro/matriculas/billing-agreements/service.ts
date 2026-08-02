import {
  billingAgreementCommitResponseSchema,
  billingAgreementPreviewResponseSchema,
  billingAgreementViewSchema,
  type BillingAgreementCommitRequest,
  type BillingAgreementCommitResponse,
  type BillingAgreementPreviewRequest,
  type BillingAgreementPreviewResponse,
  type BillingAgreementView,
} from './contracts';

export class BillingAgreementRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    message: string,
    code: string,
    status: number,
    details?: unknown,
  ) {
    super(message);
    this.name = 'BillingAgreementRequestError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readResponsePayload(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function throwRequestError(response: Response, payload: unknown): never {
  const error = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
  const code = typeof error?.code === 'string' ? error.code : 'ERRO_ACORDO_FINANCEIRO';
  const message =
    typeof error?.message === 'string'
      ? error.message
      : 'Não foi possível concluir a operação financeira.';
  throw new BillingAgreementRequestError(message, code, response.status, error?.details);
}

export async function previewBillingAgreementRequest(
  input: BillingAgreementPreviewRequest,
  signal?: AbortSignal,
): Promise<BillingAgreementPreviewResponse> {
  const response = await fetch('/api/billing-agreements/changes/preview', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    cache: 'no-store',
    signal,
  });
  const payload = await readResponsePayload(response);
  if (!response.ok) throwRequestError(response, payload);
  const parsed = billingAgreementPreviewResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new BillingAgreementRequestError(
      'O servidor retornou um preview financeiro inconsistente.',
      'RESPOSTA_FINANCEIRA_INVALIDA',
      502,
    );
  }
  return parsed.data;
}

export async function commitBillingAgreementRequest(
  input: BillingAgreementCommitRequest,
  signal?: AbortSignal,
): Promise<BillingAgreementCommitResponse> {
  const response = await fetch('/api/billing-agreements/changes', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Idempotency-Key': input.idempotencyKey,
    },
    body: JSON.stringify(input),
    cache: 'no-store',
    signal,
  });
  const payload = await readResponsePayload(response);
  if (!response.ok) throwRequestError(response, payload);
  const parsed = billingAgreementCommitResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new BillingAgreementRequestError(
      'O servidor não confirmou o resultado da alteração financeira.',
      'RESPOSTA_FINANCEIRA_INVALIDA',
      502,
    );
  }
  return parsed.data;
}

export async function getBillingAgreementRequest(
  agreementId: string,
  signal?: AbortSignal,
): Promise<BillingAgreementView> {
  const response = await fetch(`/api/billing-agreements/${encodeURIComponent(agreementId)}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal,
  });
  const payload = await readResponsePayload(response);
  if (!response.ok) throwRequestError(response, payload);
  const parsed = billingAgreementViewSchema.safeParse(payload);
  if (!parsed.success) {
    throw new BillingAgreementRequestError(
      'O acordo financeiro retornado está inconsistente.',
      'RESPOSTA_FINANCEIRA_INVALIDA',
      502,
    );
  }
  return parsed.data;
}

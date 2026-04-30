import type {
  WizardState,
  WizardStep1Data,
  WizardStep2Data,
  WizardStep3Data,
  WizardStep4Data,
  WizardStep5Data,
  SaveWizardStepResult,
  CompleteWizardResult,
  GetWizardStateResult,
} from '@alusa/finance/wizard-client';

// ================================================================================
// API Client Types
// ================================================================================

type ApiResponse<T> = {
  data: T;
};

type ApiError = {
  error: string;
  message?: string;
  details?: unknown;
};

// ================================================================================
// Error Handling
// ================================================================================

export class WizardApiError extends Error {
  readonly code?: string;
  readonly status?: number;
  readonly details?: unknown;

  constructor(message: string, params: { code?: string; status?: number; details?: unknown } = {}) {
    super(message);
    this.name = 'WizardApiError';
    this.code = params.code;
    this.status = params.status;
    this.details = params.details;
  }
}

function extractErrorMessage(json: unknown, fallback: string): string {
  if (!json || typeof json !== 'object') return fallback;
  const message = (json as { message?: unknown }).message;
  if (typeof message === 'string' && message.trim()) return message;
  const error = (json as { error?: unknown }).error;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

function extractErrorCode(json: unknown): string | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const code = (json as { code?: unknown }).code;
  if (typeof code === 'string' && code.trim()) return code;
  const error = (json as { error?: unknown }).error;
  if (typeof error === 'string' && error.trim()) return error;
  return undefined;
}

// ================================================================================
// API Functions
// ================================================================================

/**
 * Obtém o estado atual do wizard.
 */
export async function getWizardState(signal?: AbortSignal): Promise<GetWizardStateResult> {
  const response = await fetch('/api/kyc/wizard', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal,
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    throw new WizardApiError(extractErrorMessage(json, 'Não foi possível carregar o estado do wizard.'), {
      code: extractErrorCode(json),
      status: response.status,
    });
  }

  const data = (json as ApiResponse<GetWizardStateResult> | null)?.data;
  if (!data) throw new Error('Resposta inválida ao carregar o wizard.');

  return data;
}

/**
 * Salva o Step 1 (tipo de conta).
 */
export async function saveWizardStep1(data: WizardStep1Data): Promise<SaveWizardStepResult> {
  const response = await fetch('/api/kyc/wizard/step1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(data),
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    throw new WizardApiError(extractErrorMessage(json, 'Não foi possível salvar o tipo de conta.'), {
      code: extractErrorCode(json),
      status: response.status,
      details: (json as ApiError | null)?.details,
    });
  }

  const result = (json as ApiResponse<SaveWizardStepResult> | null)?.data;
  if (!result) throw new Error('Resposta inválida ao salvar step 1.');

  return result;
}

/**
 * Salva o Step 2 (dados principais).
 */
export async function saveWizardStep2(data: WizardStep2Data): Promise<SaveWizardStepResult> {
  const response = await fetch('/api/kyc/wizard/step2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(data),
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    throw new WizardApiError(extractErrorMessage(json, 'Não foi possível salvar os dados.'), {
      code: extractErrorCode(json),
      status: response.status,
      details: (json as ApiError | null)?.details,
    });
  }

  const result = (json as ApiResponse<SaveWizardStepResult> | null)?.data;
  if (!result) throw new Error('Resposta inválida ao salvar step 2.');

  return result;
}

/**
 * Salva o Step 3 (confirmação de contato).
 */
export async function saveWizardStep3(data: WizardStep3Data): Promise<SaveWizardStepResult> {
  const response = await fetch('/api/kyc/wizard/step3', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(data),
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    throw new WizardApiError(extractErrorMessage(json, 'Não foi possível confirmar o contato.'), {
      code: extractErrorCode(json),
      status: response.status,
    });
  }

  const result = (json as ApiResponse<SaveWizardStepResult> | null)?.data;
  if (!result) throw new Error('Resposta inválida ao salvar step 3.');

  return result;
}

/**
 * Salva o Step 4 (endereço).
 */
export async function saveWizardStep4(data: WizardStep4Data): Promise<SaveWizardStepResult> {
  const response = await fetch('/api/kyc/wizard/step4', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(data),
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    throw new WizardApiError(extractErrorMessage(json, 'Não foi possível salvar o endereço.'), {
      code: extractErrorCode(json),
      status: response.status,
      details: (json as ApiError | null)?.details,
    });
  }

  const result = (json as ApiResponse<SaveWizardStepResult> | null)?.data;
  if (!result) throw new Error('Resposta inválida ao salvar step 4.');

  return result;
}

/**
 * Salva o Step 5 (informações financeiras leves).
 */
export async function saveWizardStep5(data: WizardStep5Data): Promise<SaveWizardStepResult> {
  const response = await fetch('/api/kyc/wizard/step5', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(data),
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    throw new WizardApiError(extractErrorMessage(json, 'Não foi possível salvar o faturamento.'), {
      code: extractErrorCode(json),
      status: response.status,
      details: (json as ApiError | null)?.details,
    });
  }

  const result = (json as ApiResponse<SaveWizardStepResult> | null)?.data;
  if (!result) throw new Error('Resposta inválida ao salvar step 5.');

  return result;
}

/**
 * Finaliza o wizard.
 */
export async function completeWizard(): Promise<CompleteWizardResult> {
  const response = await fetch('/api/kyc/wizard/complete', {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    throw new WizardApiError(extractErrorMessage(json, 'Não foi possível finalizar o wizard.'), {
      code: extractErrorCode(json),
      status: response.status,
    });
  }

  const result = (json as ApiResponse<CompleteWizardResult> | null)?.data;
  if (!result) throw new Error('Resposta inválida ao finalizar wizard.');

  return result;
}

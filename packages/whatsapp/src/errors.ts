export class WhatsAppConfigurationError extends Error {
  readonly code = 'WHATSAPP_CONFIGURATION_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'WhatsAppConfigurationError';
  }
}

export class WhatsAppCloudApiError extends Error {
  readonly code: string | null;
  readonly status: number;
  readonly details: unknown;

  constructor(input: { status: number; code?: string | null; message: string; details?: unknown }) {
    super(input.message);
    this.name = 'WhatsAppCloudApiError';
    this.status = input.status;
    this.code = input.code ?? null;
    this.details = input.details;
  }

  get isRetryable(): boolean {
    return this.status === 408 || this.status === 409 || this.status === 425 || this.status === 429 || this.status >= 500;
  }
}

export function sanitizeWhatsAppError(error: unknown): { code: string; message: string } {
  if (error instanceof WhatsAppCloudApiError) {
    return {
      code: error.code ?? `HTTP_${error.status}`,
      message: error.message.slice(0, 500),
    };
  }

  if (error instanceof Error) {
    return { code: error.name || 'ERROR', message: error.message.slice(0, 500) };
  }

  return { code: 'UNKNOWN_ERROR', message: 'Falha desconhecida na integração WhatsApp.' };
}

export class DocumentsNotReadyError extends Error {
  readonly code = 'DOCUMENTS_NOT_READY';
  readonly retryAfterMs?: number;

  constructor(params: { retryAfterMs?: number } = {}) {
    super('Aguarde alguns segundos antes de tentar novamente.');
    this.name = 'DocumentsNotReadyError';
    this.retryAfterMs = params.retryAfterMs;
  }
}

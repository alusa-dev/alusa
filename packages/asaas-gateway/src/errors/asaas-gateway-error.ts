/**
 * Erro base para operações do gateway Asaas
 */
export class AsaasGatewayError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus?: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AsaasGatewayError';
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      httpStatus: this.httpStatus,
      details: this.details,
    };
  }
}

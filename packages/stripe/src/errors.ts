export type StripeIntegrationErrorCode =
  | 'STRIPE_CONFIG_MISSING'
  | 'STRIPE_CONFIG_INVALID'
  | 'STRIPE_ENVIRONMENT_MISMATCH'
  | 'STRIPE_SERVER_ONLY'
  | 'STRIPE_WEBHOOK_SIGNATURE_MISSING'
  | 'STRIPE_WEBHOOK_SIGNATURE_INVALID';

export class StripeIntegrationError extends Error {
  public readonly code: StripeIntegrationErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: StripeIntegrationErrorCode,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'StripeIntegrationError';
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

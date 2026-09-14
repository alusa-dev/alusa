import { AulasError } from '@/src/server/aulas/aulas-error';
import { platformBillingAccessResponse } from '@/src/server/platform-billing/capacity';

export function knownMobileAgendaError(error: unknown) {
  const billing = platformBillingAccessResponse(error);
  if (billing) {
    return {
      status: billing.status,
      body: {
        error: {
          code: billing.body.error,
          message: billing.body.message,
          details: billing.body.details,
        },
      },
    };
  }

  if (error instanceof AulasError) {
    return {
      status: error.statusCode,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      },
    };
  }

  return null;
}

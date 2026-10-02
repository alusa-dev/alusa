import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

import { apiJsonError } from './standard-response';
import { logRuntimeOperationalEvent } from '@/lib/observability/runtime-operational-log';

export type ApiErrorContext = {
  route: string;
  extra?: Record<string, unknown>;
};

export function reportApiError(error: unknown, _context: ApiErrorContext): void {
  logRuntimeOperationalEvent({ eventName: 'api.error.reported', error });
}

export function apiErrorResponse(
  error: unknown,
  context: ApiErrorContext & { fallbackMessage: string },
): ReturnType<typeof apiJsonError> {
  reportApiError(error, context);

  if (error instanceof ZodError) {
    return apiJsonError(422, 'ERRO_VALIDACAO', 'Dados inválidos.');
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2025') {
      return apiJsonError(404, 'NAO_ENCONTRADO', 'Não encontrado.');
    }
    if (error.code === 'P2021') {
      return apiJsonError(503, 'SERVICO_INDISPONIVEL', context.fallbackMessage);
    }
  }

  return apiJsonError(500, 'ERRO_INTERNO', context.fallbackMessage);
}

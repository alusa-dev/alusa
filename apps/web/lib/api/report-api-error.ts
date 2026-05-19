import * as Sentry from '@sentry/nextjs';
import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export type ApiErrorContext = {
  route: string;
  extra?: Record<string, unknown>;
};

export function reportApiError(error: unknown, context: ApiErrorContext): void {
  console.error(`[${context.route}]`, error);
  if (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.captureException(error, {
      tags: { route: context.route },
      extra: context.extra,
    });
  }
}

export function apiErrorResponse(
  error: unknown,
  context: ApiErrorContext & { fallbackMessage: string },
): NextResponse {
  reportApiError(error, context);

  if (error instanceof ZodError) {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 422 });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2025') {
      return NextResponse.json({ error: 'Não encontrado' }, { status: 404 });
    }
    if (error.code === 'P2021') {
      return NextResponse.json({ error: context.fallbackMessage }, { status: 503 });
    }
  }

  return NextResponse.json({ error: context.fallbackMessage }, { status: 500 });
}

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { createStoreSale, listStoreSales, StoreSaleError } from '@alusa/finance';

import { safeGetServerSession } from '@/lib/safe-server-session';

const querySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(50).optional(),
  search: z.string().trim().optional(),
  status: z.enum(['TODOS', 'CONCLUIDA', 'PENDENTE', 'CANCELADA']).optional(),
  finalizationType: z.enum(['TODOS', 'RECEBIMENTO_PRESENCIAL', 'COBRANCA']).optional(),
  fromDate: z.string().trim().optional(),
  toDate: z.string().trim().optional(),
});

const customerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ALUNO'),
    alunoId: z.string().trim().min(1),
    responsavelId: z.string().trim().optional().nullable(),
  }),
  z.object({
    type: z.literal('RESPONSAVEL'),
    responsavelId: z.string().trim().min(1),
  }),
  z.object({
    type: z.literal('AVULSO'),
    name: z.string().trim().min(1),
    document: z.string().trim().optional().nullable(),
    email: z.string().trim().email().optional().nullable(),
    phone: z.string().trim().optional().nullable(),
    notes: z.string().trim().optional().nullable(),
    saveCustomer: z.boolean().optional().nullable(),
  }),
]);

const createSaleSchema = z.object({
  uiRequestId: z.string().trim().min(10),
  inventoryMode: z.enum(['IMMEDIATE', 'RESERVE']).optional(),
  customer: customerSchema,
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        variantId: z.string().trim().min(1).optional().nullable(),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
  discount: z.number().min(0).optional(),
  finalization: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('RECEBIMENTO_PRESENCIAL'),
      paymentMethod: z.enum(['DINHEIRO', 'PIX_PRESENCIAL', 'CARTAO_DEBITO', 'CARTAO_CREDITO']),
      amountReceived: z.number().min(0).optional().nullable(),
    }),
    z.object({
      type: z.literal('COBRANCA'),
      dueDate: z.string().trim().min(10),
      billingType: z.enum(['BOLETO', 'PIX', 'CREDIT_CARD', 'UNDEFINED']),
      installmentCount: z.number().int().min(1).max(12).optional().nullable(),
    }),
  ]),
});

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

async function getRequestContext() {
  const session = await safeGetServerSession();
  const user = session?.user as { contaId?: string | null; id?: string | null } | undefined;
  const contaId = user?.contaId?.trim() || null;
  const operatorId = user?.id?.trim() || null;

  if (!contaId || !operatorId) {
    throw new StoreSaleError('NAO_AUTENTICADO', 'Usuário não autenticado.', 401);
  }

  return { contaId, operatorId };
}

export async function GET(request: Request) {
  try {
    const { contaId } = await getRequestContext();
    const url = new URL(request.url);
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));

    if (!parsed.success) {
      return jsonError(422, 'ERRO_VALIDACAO', 'Parâmetros inválidos.', parsed.error.flatten());
    }

    const result = await listStoreSales({ contaId, ...parsed.data });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof StoreSaleError) {
      return jsonError(error.status, error.code, error.message);
    }

    return jsonError(500, 'ERRO_LISTAR_VENDAS', (error as Error).message);
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId =
    request.headers.get('x-vercel-id') ??
    request.headers.get('x-request-id') ??
    randomUUID();

  try {
    const { contaId, operatorId } = await getRequestContext();
    const body = await request.json();
    const parsed = createSaleSchema.safeParse(body);

    if (!parsed.success) {
      return jsonError(422, 'ERRO_VALIDACAO', 'Falha de validação.', parsed.error.flatten());
    }

    const sale = await createStoreSale({
      contaId,
      operatorId,
      uiRequestId: parsed.data.uiRequestId,
      inventoryMode: parsed.data.inventoryMode,
      customer: parsed.data.customer,
      items: parsed.data.items,
      discount: parsed.data.discount,
      finalization: parsed.data.finalization,
    });

    return NextResponse.json({ data: sale }, { status: 201 });
  } catch (error) {
    console.error('[api/vendas][POST][error]', {
      requestId,
      durationMs: Date.now() - startedAt,
      errorCode: error instanceof StoreSaleError ? error.code : null,
      errorStatus: error instanceof StoreSaleError ? error.status : 500,
      errorName: error instanceof Error ? error.name : null,
      errorMessage: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    });

    if (error instanceof StoreSaleError) {
      return jsonError(error.status, error.code, error.message);
    }

    return jsonError(500, 'ERRO_CRIAR_VENDA', (error as Error).message);
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { resolveTenantSession, withTenantSession } from '@/lib/api/with-tenant-session';
import { AsaasCustomerEnsureError } from '@alusa/finance';
import { alunoDetailDTOSchema, listAlunosResultDTOSchema } from '@/features/cadastro/alunos/dtos';
import { mapAlunoDetailToDTO, mapAlunoListItemToDTO } from '@/features/cadastro/alunos/mappers';
import {
  createAlunoForTenant,
  formatZodErrors,
  listAlunosForTenant,
  parseAlunoListQuery,
} from '@/src/server/alunos/alunos-route.service';
import {
  assertPlatformAccessForConta,
  platformBillingAccessResponse,
} from '@/src/server/platform-billing/capacity';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const query = parseAlunoListQuery(new URL(request.url).searchParams);
    const result = await withTenantSession(async ({ contaId, tx }) =>
      listAlunosForTenant({ tx, contaId, query }),
    );
    if (result instanceof NextResponse) return result;

    return NextResponse.json(
      listAlunosResultDTOSchema.parse({
        items: result.items.map((item) => mapAlunoListItemToDTO(item)),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      }),
      { headers: { 'cache-control': 'private, max-age=20, stale-while-revalidate=60' } },
    );
  } catch (error) {
    console.error('Erro ao listar alunos:', error);
    return NextResponse.json({ error: 'Erro ao carregar alunos' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

    try {
      await assertPlatformAccessForConta({ contaId: auth.contaId, capability: 'STUDENT_WRITE' });
    } catch (error) {
      const blocked = platformBillingAccessResponse(error);
      if (blocked) return NextResponse.json(blocked.body, { status: blocked.status });
      throw error;
    }

    const aluno = await createAlunoForTenant({
      rawInput: await request.json(),
      contaId: auth.contaId,
    });
    return NextResponse.json(alunoDetailDTOSchema.parse(mapAlunoDetailToDTO(aluno)), { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = formatZodErrors(error.issues);
      return NextResponse.json(
        errors.length
          ? { error: errors[0].message, field: errors[0].field, errors }
          : { error: 'Payload inválido' },
        { status: 400 },
      );
    }
    console.error('Erro ao criar aluno:', error);
    if (error instanceof AsaasCustomerEnsureError) {
      const isConfigError = ['MISSING_KEY', 'DECRYPT_FAILED', 'INVALID_KEY'].includes(error.code);
      const providerStatus = error.providerStatus;
      const status = error.code === 'PAYER_INVALID'
        ? 400
        : error.code === 'ASAAS_ERROR' && providerStatus
          ? providerStatus
          : isConfigError
            ? 412
            : 503;
      const message = error.code === 'PAYER_INVALID'
        ? error.message
        : error.code === 'ASAAS_ERROR' && providerStatus && [400, 422].includes(providerStatus)
          ? error.message
          : isConfigError
            ? 'Conta de pagamentos não configurada.'
            : 'Serviço de pagamentos indisponível. Tente novamente.';
      return NextResponse.json({ error: message }, { status });
    }

    const message = error instanceof Error ? error.message : '';
    const code = (error as { code?: string }).code;
    if (code === 'P2002') {
      return NextResponse.json({ error: 'Já existe um cadastro com os mesmos dados nesta conta.' }, { status: 409 });
    }
    if (
      code === 'ALUNO_DUPLICADO' ||
      code === 'ALUNO_IDENTIDADE_AMBIGUA' ||
      code === 'RESPONSAVEL_DUPLICADO' ||
      message.includes('já existe') ||
      message.includes('já está em uso')
    ) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}

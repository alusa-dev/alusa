import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { syncResponsavelAsaasCustomer } from '@alusa/finance';
import {
  createResponsavelInputDTOSchema,
  createResponsavelResultDTOSchema,
  listResponsaveisQueryDTOSchema,
  listResponsaveisResultDTOSchema,
} from '@/features/responsaveis/dtos';
import {
  mapCreateResponsavelDTOToData,
  mapListResponsaveisQueryToFilters,
  mapResponsavelRecordToMaskedSummaryDTO,
  mapResponsavelRecordToSummaryDTO,
} from '@/features/responsaveis/mappers';
import {
  assertPlatformAccessForConta,
  platformBillingAccessResponse,
} from '@/src/server/platform-billing/capacity';
import {
  createResponsavelForTenant,
  findResponsavelByTenantIdentity,
  listResponsaveisForTenant,
} from '@/src/server/responsaveis/responsavel.service';

/**
 * GET /api/responsaveis
 * Lista responsáveis (busca por nome/CPF)
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const contaId = auth.contaId;
    const { searchParams } = new URL(req.url);
    const parsedQuery = listResponsaveisQueryDTOSchema.safeParse({
      q: searchParams.get('q') ?? undefined,
      status: searchParams.get('status') ?? undefined,
    });
    if (!parsedQuery.success) {
      return NextResponse.json(
        {
          error: 'Parâmetros inválidos',
          details: parsedQuery.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }
    const filters = mapListResponsaveisQueryToFilters(parsedQuery.data, contaId);

    const responsaveis = await listResponsaveisForTenant(filters);

    const dto = listResponsaveisResultDTOSchema.parse({
      items: responsaveis.map(mapResponsavelRecordToMaskedSummaryDTO),
    });

    return NextResponse.json(dto);
  } catch (error) {
    console.error('[API /api/responsaveis GET]', error);
    return NextResponse.json({ error: 'Erro ao buscar responsáveis' }, { status: 500 });
  }
}

/**
 * POST /api/responsaveis
 * Cria novo responsável
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const contaId = auth.contaId;
    try {
      await assertPlatformAccessForConta({ contaId, capability: 'STUDENT_WRITE' });
    } catch (error) {
      const blocked = platformBillingAccessResponse(error);
      if (blocked) return NextResponse.json(blocked.body, { status: blocked.status });
      throw error;
    }
    const raw = await req.json().catch(() => null);

    const validation = createResponsavelInputDTOSchema.safeParse(raw);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Dados inválidos',
          details: validation.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const data = validation.data;

    // Multi-tenant: verificar se CPF ou email já existe NESTA CONTA
    const cpfDigits = data.cpf.replace(/\D/g, '');
    const existente = await findResponsavelByTenantIdentity({
      contaId,
      cpf: cpfDigits,
      email: data.email ? data.email.trim().toLowerCase() : undefined,
    });

    if (existente) {
      const dto = createResponsavelResultDTOSchema.parse(
        mapResponsavelRecordToSummaryDTO(existente),
      );
      return NextResponse.json(
        {
          ...dto,
          reused: true,
          asaasSync: { status: 'SKIPPED', message: 'Responsável já existente nesta conta.' },
        },
        { status: 200 },
      );
    }

    // Criar responsável com contaId
    const responsavel = await createResponsavelForTenant({
      data: mapCreateResponsavelDTOToData(data, contaId),
      contaId,
      actorId: auth.userId,
      consentimentoComunicacoes: data.consentimentoComunicacoes ?? false,
      consentimentoMarketing: data.consentimentoMarketing ?? false,
    });

    const dto = createResponsavelResultDTOSchema.parse(
      mapResponsavelRecordToSummaryDTO({
        ...responsavel,
        cpf: responsavel.cpf || cpfDigits,
      }),
    );

    let asaasSync: { status: 'OK' | 'FAILED' | 'SKIPPED'; message?: string } = { status: 'SKIPPED' };
    if (data.financeiro ?? true) {
      const synced = await syncResponsavelAsaasCustomer({
        contaId,
        responsavelId: responsavel.id,
        requireFiscalAddress: true,
        notificationSyncMode: 'deferred',
      });
      asaasSync = synced.ok
        ? { status: 'OK' }
        : { status: 'FAILED', message: synced.message };
    }

    return NextResponse.json({ ...dto, asaasSync }, { status: 201 });
  } catch (error) {
    console.error('[API /api/responsaveis POST]', error);
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json(
        { error: 'CPF ou email do responsável já está cadastrado nesta conta.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Erro ao criar responsável' }, { status: 500 });
  }
}

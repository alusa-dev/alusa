import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { fiscalServiceInputSchema } from '@/features/configuracoes/notafiscal/dtos';
import { createFiscalService, listFiscalServices } from '@alusa/finance';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

type SessionUser = { id?: string; role?: string; contaId?: string };

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function fiscalServiceErrorMessage(error: string): string | undefined {
  if (error === 'FISCAL_CORE_NOT_SYNCED') {
    return 'Salve emissor e informações fiscais antes de cadastrar serviços.';
  }
  if (error === 'SERVICO_MUNICIPAL_INVALIDO') {
    return 'Selecione um serviço municipal da lista ou informe um código manual válido.';
  }
  if (error === 'PIS_COFINS_INVALIDO') {
    return 'Revise a situação tributária e as alíquotas de PIS/COFINS conforme as regras do Portal Nacional.';
  }
  if (error === 'IBS_CBS_INVALIDO') {
    return 'Preencha NBS, código nacional do serviço, situação tributária, classificação tributária e indicador de operação para emitir com IBS/CBS.';
  }
  return undefined;
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    const user = (session as { user?: SessionUser } | null)?.user;
    if (!user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const services = await listFiscalServices(user.contaId);
    return json(200, {
      data: services.map((s) => ({
        id: s.id,
        name: s.name,
        municipalServiceCode: s.municipalServiceCode,
        source: s.source,
        nationalTaxCode: s.nationalTaxCode,
        nbsCode: s.nbsCode,
        defaultDescription: s.defaultDescription,
        isDefault: s.isDefault,
        iss: Number(s.iss),
        pis: Number(s.pis),
        cofins: Number(s.cofins),
        csll: Number(s.csll),
        inss: Number(s.inss),
        ir: Number(s.ir),
        retainIss: s.retainIss,
        asaasMunicipalServiceId: s.asaasMunicipalServiceId,
        taxSituationCode: s.taxSituationCode,
        taxClassificationCode: s.taxClassificationCode,
        operationIndicatorCode: s.operationIndicatorCode,
        pisCofinsTaxStatus: s.pisCofinsTaxStatus,
        operationPis: s.operationPis == null ? null : Number(s.operationPis),
        operationCofins: s.operationCofins == null ? null : Number(s.operationCofins),
        useTaxSystemReformNT007: s.useTaxSystemReformNT007,
      })),
    });
  } catch (error) {
    console.error('[Config NotaFiscal Servicos][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    const user = (session as { user?: SessionUser } | null)?.user;
    if (!user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const gate = await guardFinancialAccountOr412(user.contaId);
    if (!gate.ok) return gate.response;

    const parsed = fiscalServiceInputSchema.safeParse(await request.json());
    if (!parsed.success) return json(422, { error: 'PAYLOAD_INVALIDO', details: parsed.error.flatten() });

    const result = await createFiscalService(user.contaId, parsed.data);
    if (!result.success) {
      const status =
        result.error === 'FISCAL_CORE_NOT_SYNCED'
          ? 412
          : result.error === 'SERVICO_MUNICIPAL_INVALIDO' ||
              result.error === 'PIS_COFINS_INVALIDO'
              || result.error === 'IBS_CBS_INVALIDO'
            ? 422
            : 500;
      return json(status, {
        error: result.error,
        message: fiscalServiceErrorMessage(result.error),
      });
    }

    return json(201, { data: result.data });
  } catch (error) {
    console.error('[Config NotaFiscal Servicos][POST]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';

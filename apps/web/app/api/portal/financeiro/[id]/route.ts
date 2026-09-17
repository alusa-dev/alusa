import { NextRequest } from 'next/server';
import {
  requirePortalUser,
  resolvePortalAlunoIds,
  resolvePortalResponsavelId,
} from '@/features/portal/api-helpers';
import {
  portalFinanceiroDetailDTOSchema,
  portalRouteIdParamsDTOSchema,
} from '@/features/portal/dtos';
import { mapPortalFinanceiroDetailToDTO } from '@/features/portal/mappers';
import { jsonNoStore } from '@/lib/http-security';
import {
  getPortalFinanceDetail,
  syncPortalFinanceDetail,
} from '@/src/server/portal/portal-finance-detail.service';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requirePortalUser();
    if ('response' in auth) return auth.response;

    const { id } = portalRouteIdParamsDTOSchema.parse(await params);
    const alunoIds = await resolvePortalAlunoIds(auth.user);
    const detail = await getPortalFinanceDetail({
      id,
      contaId: auth.user.contaId,
      alunoIds,
      responsavelId: await resolvePortalResponsavelId(auth.user),
      forceRefresh: _req.nextUrl.searchParams.get('fresh') === '1',
    });

    if (!detail) return jsonNoStore({ error: 'Cobrança não encontrada' }, { status: 404 });
    return jsonNoStore(
      portalFinanceiroDetailDTOSchema.parse(mapPortalFinanceiroDetailToDTO(detail)),
    );
  } catch (error) {
    console.error('Erro ao buscar cobrança:', error);
    return jsonNoStore({ error: 'Erro ao buscar cobrança' }, { status: 500 });
  }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requirePortalUser();
    if ('response' in auth) return auth.response;

    const { id } = portalRouteIdParamsDTOSchema.parse(await params);
    const alunoIds = await resolvePortalAlunoIds(auth.user);
    const result = await syncPortalFinanceDetail({
      id,
      contaId: auth.user.contaId,
      alunoIds,
      responsavelId: await resolvePortalResponsavelId(auth.user),
    });

    if (!result.ok) {
      return result.kind === 'NOT_FOUND'
        ? jsonNoStore(
            { success: false, error: 'Cobrança não encontrada ou sem integração Asaas' },
            { status: 404 },
          )
        : jsonNoStore({ success: false, error: result.error }, { status: 502 });
    }

    return jsonNoStore({
      success: true,
      asaasPaymentId: result.asaasPaymentId,
      paymentStatus: result.paymentStatus,
      appliedEvent: result.appliedEvent,
    });
  } catch (error) {
    console.error('[Portal Financeiro][sync-asaas] Erro:', error);
    return jsonNoStore({ success: false, error: 'Erro ao sincronizar cobrança' }, { status: 500 });
  }
}

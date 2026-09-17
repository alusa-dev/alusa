import { NextRequest } from 'next/server';
import {
  findPublicEventContractByToken,
  mapPublicEventContractToDTO,
} from '@alusa/lib/events/event-contracts.service';
import { hashPublicContractToken } from '@alusa/lib/contracts/tokens';
import { publicEventContractRouteParamsDTOSchema } from '@/features/public/dtos';
import { jsonSensitive } from '@/lib/http-security';
import { ipFromRequest } from '@/lib/rate-limit';
import { recordPublicEventContractEvidence } from '@/src/server/contracts/public-contract-evidence.service';

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const parsedParams = publicEventContractRouteParamsDTOSchema.safeParse(await params);
    if (!parsedParams.success) {
      return jsonSensitive({ error: { message: 'Contrato não encontrado' } }, { status: 404 });
    }
    const { token } = parsedParams.data;
    const contract = await findPublicEventContractByToken(token);
    if (!contract) return jsonSensitive({ error: { message: 'Contrato não encontrado' } }, { status: 404 });
    if (contract.status === 'CANCELADO') return jsonSensitive({ error: { message: 'Este contrato foi cancelado' } }, { status: 400 });
    if (contract.status === 'EXPIRADO' || (contract.tokenExpiraEm && new Date() > contract.tokenExpiraEm)) {
      return jsonSensitive({ error: { message: 'Link expirado' } }, { status: 400 });
    }
    const tokenHash = hashPublicContractToken(token);
    void recordPublicEventContractEvidence({
      contaId: contract.contaId,
      eventoContratoId: contract.id,
      type: 'PUBLIC_LINK_OPENED',
      ip: ipFromRequest(request),
      userAgent: request.headers.get('user-agent')?.slice(0, 512) ?? null,
      payload: { tokenHash },
    }).catch(() => undefined);
    return jsonSensitive(mapPublicEventContractToDTO(contract));
  } catch {
    return jsonSensitive({ error: { message: 'Erro ao carregar contrato' } }, { status: 500 });
  }
}

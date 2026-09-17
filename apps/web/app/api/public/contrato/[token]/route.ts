
import { NextRequest } from 'next/server';
import {
  contratoPublicTokenParamsDTOSchema,
  contratoPublicoDTOSchema,
} from '@/features/contratos/dtos';
import { mapPublicContratoRecordToDTO } from '@/features/contratos/mappers';
import { jsonSensitive } from '@/lib/http-security';
import { hashPublicContractToken } from '@alusa/lib/contracts/tokens';
import { ipFromRequest } from '@/lib/rate-limit';
import { expireContractSignatureLinks } from '@/src/server/contracts/expire-contract-signature-links.service';
import { recordPublicContractEvidence } from '@/src/server/contracts/public-contract-evidence.service';
import { findPublicContractByToken } from '@/src/server/contracts/contract-read.service';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const rawParams = await params;
    const { token } = contratoPublicTokenParamsDTOSchema.parse(rawParams);
    const tokenHash = hashPublicContractToken(token);

    const contrato = await findPublicContractByToken(token);

    if (!contrato) return jsonSensitive({ error: { message: 'Contrato não encontrado' } }, { status: 404 });

    if (contrato.status === 'CANCELADO') {
      return jsonSensitive({ error: { message: 'Este contrato foi cancelado' } }, { status: 400 });
    }

    if (contrato.status === 'EXPIRADO') {
      return jsonSensitive({ error: { message: 'Link expirado' } }, { status: 400 });
    }

    if (contrato.tokenExpiraEm && new Date() > contrato.tokenExpiraEm) {
      await expireContractSignatureLinks(
        { contaId: contrato.contaId, contractId: contrato.id, limit: 1 },
      ).catch(() => undefined);
      return jsonSensitive({ error: { message: 'Link expirado' } }, { status: 400 });
    }

    void recordPublicContractEvidence({
      contaId: contrato.contaId,
      contratoId: contrato.id,
      type: 'PUBLIC_LINK_OPENED',
      ip: ipFromRequest(request),
      userAgent: request.headers.get('user-agent')?.slice(0, 512) ?? null,
      payload: { tokenHash },
    }).catch(() => undefined);

    return jsonSensitive(
      contratoPublicoDTOSchema.parse(mapPublicContratoRecordToDTO(contrato)),
    );
  } catch (error) {
    console.error('[PUBLIC_CONTRATO_GET]', error);
    return jsonSensitive(
      { error: { message: 'Erro ao carregar contrato' } },
      { status: 500 },
    );
  }
}

import { NextRequest } from 'next/server';
import { findPublicEventContractByToken, mapPublicEventContractToDTO, hashPublicContractToken } from '@alusa/lib';
import { hashCanonicalPayload } from '@alusa/domain';
import { jsonSensitive } from '@/lib/http-security';
import { ipFromRequest } from '@/lib/rate-limit';
import { prisma } from '@/prisma/client';

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const contract = await findPublicEventContractByToken(token);
    if (!contract) return jsonSensitive({ error: { message: 'Contrato não encontrado' } }, { status: 404 });
    if (contract.status === 'CANCELADO') return jsonSensitive({ error: { message: 'Este contrato foi cancelado' } }, { status: 400 });
    if (contract.status === 'EXPIRADO' || (contract.tokenExpiraEm && new Date() > contract.tokenExpiraEm)) {
      return jsonSensitive({ error: { message: 'Link expirado' } }, { status: 400 });
    }
    const tokenHash = hashPublicContractToken(token);
    void prisma.eventoContratoEvidence.create({
      data: {
        contaId: contract.contaId,
        eventoContratoId: contract.id,
        type: 'PUBLIC_LINK_OPENED',
        ip: ipFromRequest(request),
        userAgent: request.headers.get('user-agent')?.slice(0, 512) ?? null,
        payload: { tokenHash },
        payloadHash: hashCanonicalPayload({ tokenHash }),
      },
    }).catch(() => undefined);
    return jsonSensitive(mapPublicEventContractToDTO(contract));
  } catch {
    return jsonSensitive({ error: { message: 'Erro ao carregar contrato' } }, { status: 500 });
  }
}

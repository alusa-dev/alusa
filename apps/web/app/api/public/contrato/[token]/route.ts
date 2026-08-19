
import { NextRequest } from 'next/server';
import { prisma } from '@/prisma/client';
import {
  contratoPublicTokenParamsDTOSchema,
  contratoPublicoDTOSchema,
} from '@/features/contratos/dtos';
import { mapPublicContratoRecordToDTO } from '@/features/contratos/mappers';
import { jsonSensitive } from '@/lib/http-security';
import { createContractEvidence, hashPublicContractToken } from '@alusa/lib';
import { ipFromRequest } from '@/lib/rate-limit';
import { expireContractSignatureLinks } from '@/src/server/contracts/expire-contract-signature-links.service';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const rawParams = await params;
    const { token } = contratoPublicTokenParamsDTOSchema.parse(rawParams);
    const tokenHash = hashPublicContractToken(token);

    const contrato = await prisma.contrato.findFirst({
      where: {
        OR: [
          { tokenPublicoHash: tokenHash },
          { tokenPublicoHash: null, tokenPublico: token },
        ],
      },
      select: {
        id: true,
        contaId: true,
        conta: { select: { nome: true } },
        arquivoPdfUrl: true,
        hashPdf: true,
        camposAssinaturaSnapshot: true,
        termosConsentimentoSnapshot: true,
        status: true,
        tokenExpiraEm: true,
        matricula: {
          select: {
            aluno: {
              select: {
                nome: true,
                dataNasc: true,
                responsaveis: {
                  where: {},
                  orderBy: { id: 'asc' },
                  take: 1,
                  select: { responsavel: { select: { nome: true } } },
                },
              },
            },
            responsavelFinanceiro: { select: { nome: true } },
          },
        },
        modelo: {
          select: {
            campos: { orderBy: { ordem: 'asc' } },
            consentimentos: { orderBy: { ordem: 'asc' } },
          },
        },
      },
    });

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
        { prisma },
      ).catch(() => undefined);
      return jsonSensitive({ error: { message: 'Link expirado' } }, { status: 400 });
    }

    void createContractEvidence(prisma as never, {
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

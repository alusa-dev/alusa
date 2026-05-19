
import { NextRequest } from 'next/server';
import { prisma } from '@/prisma/client';
import {
  contratoPublicTokenParamsDTOSchema,
  contratoPublicoDTOSchema,
} from '@/features/contratos/dtos';
import { mapPublicContratoRecordToDTO } from '@/features/contratos/mappers';
import { jsonSensitive } from '@/lib/http-security';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
    const rawParams = await params;
  const { token } = contratoPublicTokenParamsDTOSchema.parse(params);

  try {
    const contrato = await prisma.contrato.findUnique({
      where: { tokenPublico: token },
      select: {
        id: true,
        arquivoPdfUrl: true,
        hashPdf: true,
        status: true,
        tokenExpiraEm: true,
        matricula: {
          select: {
            aluno: { select: { nome: true } },
            responsavelFinanceiro: { select: { nome: true } },
          },
        },
      },
    });

    if (!contrato) {
      return jsonSensitive({ error: { message: 'Contrato não encontrado' } }, { status: 404 });
    }

    if (contrato.status === 'CANCELADO') {
      return jsonSensitive({ error: { message: 'Este contrato foi cancelado' } }, { status: 400 });
    }

    if (contrato.status === 'EXPIRADO') {
      return jsonSensitive({ error: { message: 'Link expirado' } }, { status: 400 });
    }

    if (contrato.tokenExpiraEm && new Date() > contrato.tokenExpiraEm) {
      return jsonSensitive({ error: { message: 'Link expirado' } }, { status: 400 });
    }

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

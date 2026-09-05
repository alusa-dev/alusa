import { NextRequest, NextResponse } from 'next/server';
import { canRegenerateContractLink } from '@alusa/domain';
import { createContractEvidence, createPublicContractToken } from '@alusa/lib';
import { encryptSecret } from '@alusa/database';
import { normalizeBrazilianWhatsAppPhone } from '@alusa/whatsapp';
import { getWhatsAppRuntimeConfig } from '@/src/server/whatsapp/config';
import { prisma } from '@/prisma/client';
import { getSessionUser } from '@/lib/auth/session';
import { contratoDTOSchema, contratoRouteParamsDTOSchema } from '@/features/contratos/dtos';
import { mapContratoRecordToDTO } from '@/features/contratos/mappers';

async function getContratoWithRelations(id: string, contaId: string) {
  return prisma.contrato.findFirst({
    where: {
      id,
      contaId,
      matricula: { contaId },
    },
    include: {
      modelo: {
        select: {
          id: true,
          nome: true,
        },
      },
      matricula: {
        select: {
          id: true,
          contratoAtualId: true,
          aluno: {
            select: {
              id: true,
              nome: true,
              cpf: true,
            },
          },
          turma: {
            select: {
              id: true,
              nome: true,
            },
          },
        },
      },
    },
  });
}

export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user?.contaId) {
    return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });
  }

  try {
    const rawParams = await params;
    const { id } = contratoRouteParamsDTOSchema.parse(rawParams);
    const contrato = await prisma.contrato.findFirst({
      where: {
        id,
        contaId: user.contaId,
        matricula: { contaId: user.contaId },
      },
      include: {
        matricula: {
          select: {
            id: true,
            aluno: {
              select: {
                dataNasc: true,
                telefone: true,
                responsaveis: {
                  where: { contaId: user.contaId, tipoVinculo: { in: ['FINANCEIRO', 'PRINCIPAL'] } },
                  orderBy: { id: 'asc' },
                  take: 1,
                  select: { responsavel: { select: { telefone: true } } },
                },
              },
            },
            responsavelFinanceiro: { select: { telefone: true } },
          },
        },
      },
    });

    if (!contrato) {
      return NextResponse.json(
        { error: { message: 'Contrato não encontrado' } },
        { status: 404 },
      );
    }

    if (!canRegenerateContractLink(contrato.status)) {
      return NextResponse.json(
        { error: { message: 'Não é possível regenerar link para este contrato' } },
        { status: 400 },
      );
    }

    const novaExpiracao = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const { token: tokenPublico, tokenHash: tokenPublicoHash } = createPublicContractToken();

    await prisma.$transaction(async (tx) => {
      const updated = await tx.contrato.updateMany({
        where: { id: contrato.id, contaId: user.contaId, status: contrato.status },
        data: {
          tokenPublico: `hash:${tokenPublicoHash}`,
          tokenPublicoHash,
          tokenPublicoCriptografado: encryptSecret(tokenPublico),
          tokenExpiraEm: novaExpiracao,
          status: 'PENDENTE',
        },
      });
      if (updated.count !== 1) throw new Error('CONTRACT_CHANGED_CONCURRENTLY');

      await createContractEvidence(tx as never, {
        contaId: user.contaId,
        contratoId: contrato.id,
        type: 'PUBLIC_LINK_CREATED',
        actorType: 'USER',
        actorId: user.id,
        payload: {
          tokenPublicoHash,
          tokenExpiraEm: novaExpiracao.toISOString(),
          regenerated: true,
        },
      });

      await tx.matricula.updateMany({
        where: { id: contrato.matricula.id, contaId: user.contaId },
        data: { contratoAtualId: contrato.id, statusContrato: 'AGUARDANDO_ASSINATURA' },
      });

      const alunoMaior = isAdult(contrato.matricula.aluno.dataNasc);
      const recipientPhone = alunoMaior
        ? contrato.matricula.aluno.telefone
        : contrato.matricula.responsavelFinanceiro?.telefone ?? contrato.matricula.aluno.responsaveis[0]?.responsavel.telefone ?? null;
      if (recipientPhone) {
        let normalized: string;
        try {
          normalized = normalizeBrazilianWhatsAppPhone(recipientPhone);
        } catch {
          normalized = '';
        }
        if (normalized) {
          const config = getWhatsAppRuntimeConfig();
          await tx.contractWhatsAppNotification.upsert({
            where: {
              uq_contract_whatsapp_notification_dedupe: {
                contaId: user.contaId,
                contratoId: contrato.id,
                recipientPhone: normalized,
                templateName: alunoMaior ? config.contractMajorTemplateName : config.contractMinorTemplateName,
              },
            },
            update: {
              tokenCriptografado: encryptSecret(tokenPublico),
              status: 'PENDING',
              nextAttemptAt: new Date(),
              lockedAt: null,
              lockedBy: null,
              processedAt: null,
              lastErrorCode: null,
              lastError: null,
            },
            create: {
              contaId: user.contaId,
              contratoId: contrato.id,
              matriculaId: contrato.matricula.id,
              templateName: alunoMaior ? config.contractMajorTemplateName : config.contractMinorTemplateName,
              languageCode: config.contractTemplateLanguage,
              recipientPhone: normalized,
              recipientType: alunoMaior ? 'ALUNO' : 'RESPONSAVEL',
              tokenCriptografado: encryptSecret(tokenPublico),
              correlationId: `contract:${contrato.id}:regenerated`,
            },
          });
        }
      }
    });

    const hydratedContrato = await getContratoWithRelations(contrato.id, user.contaId);

    if (!hydratedContrato) {
      return NextResponse.json(
        { error: { message: 'Contrato não encontrado após regeneração' } },
        { status: 500 },
      );
    }

    return NextResponse.json(
      contratoDTOSchema.parse(mapContratoRecordToDTO(hydratedContrato, { publicToken: tokenPublico })),
    );
  } catch (error) {
    console.error('[CONTRATO_REGENERAR]', error);
    return NextResponse.json(
      { error: { message: 'Erro ao regenerar link do contrato' } },
      { status: 500 },
    );
  }
}

function isAdult(value: Date): boolean {
  const now = new Date();
  const birth = new Date(value);
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday = now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age >= 18;
}

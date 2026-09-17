import { NextRequest, NextResponse } from 'next/server';
import { buildSubscriptionExternalReference, createSubscription } from '@alusa/finance';
import { getSessionUser } from '@/lib/auth/session';
import {
  createContratoInputDTOSchema,
  listContratosQueryDTOSchema,
  listContratosResultDTOSchema,
} from '@/features/contratos/dtos';
import { mapContratoRecordToDTO } from '@/features/contratos/mappers';
import { z } from 'zod';
import { materializeSubscriptionPaymentForCharge } from '@/src/server/matriculas/subscription-payment-materialization';
import { calcularPrecoMatricula } from '@/src/server/matriculas/matricula.service';
import {
  formatIsoDate,
  mapFormaPagamentoToBillingType,
  mapPeriodicidadeToCycle,
  resolveChargeableFirstDueDate,
} from '@/src/server/matriculas/recurring-billing';
import {
  EnrollmentContractModelNotFoundError,
  EnrollmentContractModelSignatureFieldsError,
  issueEnrollmentContract,
  PendingEnrollmentContractAlreadyExistsError,
} from '@/src/server/contracts/issue-enrollment-contract.service';
import {
  assertPlatformAccessForConta,
  platformBillingAccessResponse,
} from '@/src/server/platform-billing/capacity';
import { getContractForTenant, listContractsForTenant } from '@/src/server/contracts/contract-read.service';
import { getContractCreationContext, issueContractForTenant, syncContractSubscriptionForTenant } from '@/src/server/contracts/contract-creation.service';

export function replaceMentionSpans(html: string) {
  const mentionRegex = /<span\s+[^>]*?data-type=["']mention["'][^>]*?>[^<]*?<\/span>/g;

  return html.replace(mentionRegex, (match) => {
    const idMatch = match.match(/data-id=["']([^"']+)["']/);
    return idMatch ? idMatch[1] : match;
  });
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const parsedQuery = listContratosQueryDTOSchema.safeParse({
    matriculaId: searchParams.get('matriculaId') ?? undefined,
    alunoId: searchParams.get('alunoId') ?? undefined,
    status: searchParams.get('status') ?? undefined,
  });

  if (!parsedQuery.success) {
    return NextResponse.json(
      { error: { message: parsedQuery.error.issues[0]?.message ?? 'Parâmetros inválidos' } },
      { status: 400 },
    );
  }

  const { matriculaId, alunoId, status } = parsedQuery.data;

  try {
    const contratos = await listContractsForTenant({ contaId: user.contaId, matriculaId, alunoId, status });

    return NextResponse.json(
      listContratosResultDTOSchema.parse(contratos.map((contrato) => mapContratoRecordToDTO(contrato))),
    );
  } catch (error) {
    console.error('[CONTRATOS_GET]', error);
    return NextResponse.json(
      { error: { message: 'Erro ao listar contratos' } },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });
  }

  try {
    const json = await request.json();
    const body = createContratoInputDTOSchema.parse(json);
    const { contaId } = user;

    try {
      await assertPlatformAccessForConta({ contaId, capability: 'ENROLLMENT_WRITE' });
    } catch (error) {
      const blocked = platformBillingAccessResponse(error);
      if (blocked) return NextResponse.json({ error: blocked.body }, { status: blocked.status });
      throw error;
    }

    const context = await getContractCreationContext({ contaId, matriculaId: body.matriculaId, contratoOrigemId: body.contratoOrigemId });
    const matricula = context?.matricula;

    if (!matricula) {
      return NextResponse.json(
        { error: { message: 'Matrícula não encontrada' } },
        { status: 404 },
      );
    }

    if (matricula.aluno.contaId !== user.contaId) {
      return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 403 });
    }

    if (context?.existingPendente) {
      return NextResponse.json(
        { error: { message: 'Já existe um contrato pendente para esta matrícula.' } },
        { status: 409 },
      );
    }

    if (body.contratoOrigemId) {
      const origem = context?.origem;

      if (!origem || origem.matriculaId !== body.matriculaId) {
        return NextResponse.json(
          { error: { message: 'Contrato de origem inválido para aditivo.' } },
          { status: 400 },
        );
      }

      if (origem.status !== 'ASSINADO') {
        return NextResponse.json(
          { error: { message: 'Aditivo só pode ser gerado a partir de um contrato assinado.' } },
          { status: 400 },
        );
      }
    }

    const issued = await issueContractForTenant({
      contaId: user.contaId,
      matriculaId: body.matriculaId,
      modeloId: body.modeloId,
      contratoOrigemId: body.contratoOrigemId,
      actorId: user.id,
    });
    const contrato = issued.contrato;
    const tokenPublico = issued.publicToken;

    if (!tokenPublico) {
      throw new Error('CONTRACT_PUBLIC_TOKEN_NOT_ISSUED');
    }

    let subscriptionSync = null;

    try {
      subscriptionSync = await syncContractSubscriptionForTenant({
        contaId: user.contaId,
        contratoId: contrato.id,
        actorId: user.id,
        matricula,
      });
    } catch (syncError) {
      subscriptionSync = {
        success: false,
        error: syncError instanceof Error ? syncError.message : 'ERRO_SINCRONIZAR_ASSINATURA',
      };
    }

    const hydratedContrato = await getContractForTenant({ id: contrato.id, contaId: user.contaId });

    if (!hydratedContrato) {
      return NextResponse.json(
        { error: { message: 'Contrato não encontrado após criação' } },
        { status: 500 },
      );
    }

    return NextResponse.json(
      mapContratoRecordToDTO(hydratedContrato, {
        subscriptionSync: subscriptionSync ?? null,
        publicToken: tokenPublico,
      }),
    );
  } catch (error) {
    console.error('[CONTRATOS_POST]', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: { message: 'Dados inválidos', details: error.errors } },
        { status: 400 },
      );
    }

    if ((error as { code?: string })?.code === 'P2002') {
      return NextResponse.json(
        { error: { message: 'Já existe um contrato pendente para esta matrícula.' } },
        { status: 409 },
      );
    }

    if (error instanceof PendingEnrollmentContractAlreadyExistsError) {
      return NextResponse.json(
        { error: { message: error.message } },
        { status: 409 },
      );
    }

    if (error instanceof EnrollmentContractModelNotFoundError) {
      return NextResponse.json(
        { error: { message: 'Modelo de contrato não encontrado' } },
        { status: 404 },
      );
    }

    if (error instanceof EnrollmentContractModelSignatureFieldsError) {
      return NextResponse.json(
        { error: { message: error.message } },
        { status: 422 },
      );
    }

    return NextResponse.json(
      { error: { message: 'Erro ao gerar contrato' } },
      { status: 500 },
    );
  }
}

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { PeriodicidadePlano } from '@prisma/client';
import { buildSubscriptionExternalReference, createSubscription } from '@alusa/finance';
import { prisma } from '@/prisma/client';
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
  resolveFirstDueDate,
} from '@/src/server/matriculas/recurring-billing';

export function replaceMentionSpans(html: string) {
  const mentionRegex = /<span\s+[^>]*?data-type=["']mention["'][^>]*?>[^<]*?<\/span>/g;

  return html.replace(mentionRegex, (match) => {
    const idMatch = match.match(/data-id=["']([^"']+)["']/);
    return idMatch ? idMatch[1] : match;
  });
}

async function getContratoWithRelations(id: string, contaId: string) {
  return prisma.contrato.findFirst({
    where: {
      id,
      matricula: { aluno: { contaId } },
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
    const contratos = await prisma.contrato.findMany({
      where: {
        matricula: {
          aluno: { contaId: user.contaId, ...(alunoId ? { id: alunoId } : {}) },
          ...(matriculaId ? { id: matriculaId } : {}),
        },
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
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

    const matricula = await prisma.matricula.findFirst({
      where: { id: body.matriculaId, aluno: { contaId } },
      select: {
        id: true,
        alunoId: true,
        dataInicio: true,
        dataFimContrato: true,
        vencimentoDia: true,
        formaPagamento: true,
        descontoAntecipado: true,
        prazoDesconto: true,
        descontoTipo: true,
        jurosMensal: true,
        multaPercentual: true,
        multaTipo: true,
        asaasSubscriptionId: true,
        aluno: {
          select: {
            id: true,
            contaId: true,
            nome: true,
            cpf: true,
            email: true,
            telefone: true,
            enderecoLogradouro: true,
            enderecoNumero: true,
            enderecoBairro: true,
            enderecoCidade: true,
            enderecoUf: true,
          },
        },
        responsavelFinanceiro: {
          select: {
            nome: true,
            cpf: true,
            email: true,
            telefone: true,
            enderecoLogradouro: true,
            enderecoNumero: true,
            enderecoBairro: true,
            enderecoCidade: true,
            enderecoUf: true,
          },
        },
        turma: { select: { nome: true } },
        plano: { select: { id: true, nome: true, valor: true, periodicidade: true } },
        combo: { select: { id: true, nome: true, valor: true, periodicidade: true } },
        descontos: {
          select: {
            desconto: {
              select: { tipo: true, valor: true },
            },
          },
        },
        cobrancas: {
          where: { tipo: 'MENSALIDADE' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!matricula) {
      return NextResponse.json(
        { error: { message: 'Matrícula não encontrada' } },
        { status: 404 },
      );
    }

    if (matricula.aluno.contaId !== user.contaId) {
      return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 403 });
    }

    const existingPendente = await prisma.contrato.findFirst({
      where: {
        matriculaId: body.matriculaId,
        status: 'PENDENTE',
      },
      select: { id: true },
    });

    if (existingPendente) {
      return NextResponse.json(
        { error: { message: 'Já existe um contrato pendente para esta matrícula.' } },
        { status: 409 },
      );
    }

    if (body.contratoOrigemId) {
      const origem = await prisma.contrato.findUnique({
        where: { id: body.contratoOrigemId },
        select: { id: true, matriculaId: true, status: true },
      });

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

    const modelo = await prisma.contratoModelo.findFirst({
      where: { id: body.modeloId, contaId: user.contaId, status: 'ATIVO' },
    });

    if (!modelo) {
      return NextResponse.json(
        { error: { message: 'Modelo de contrato não encontrado' } },
        { status: 404 },
      );
    }

    const tokenPublico = crypto.randomUUID();
    const tokenExpiraEm = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const contrato = await prisma.$transaction(async (tx) => {
      const created = await tx.contrato.create({
        data: {
          matriculaId: body.matriculaId,
          modeloId: body.modeloId,
          contratoOrigemId: body.contratoOrigemId,
          arquivoPdfUrl: modelo.arquivoPdfUrl,
          hashPdf: modelo.hashSha256,
          status: 'PENDENTE',
          tokenPublico,
          tokenExpiraEm,
        },
      });

      await tx.matricula.update({
        where: { id: body.matriculaId },
        data: {
          statusContrato: 'AGUARDANDO_ASSINATURA',
          contratoAtualId: created.id,
        },
      });

      return created;
    });

    let subscriptionSync:
      | {
          success: boolean;
          error?: string;
          asaasSubscriptionId?: string | null;
          asaasPaymentId?: string | null;
          invoiceUrl?: string | null;
          bankSlipUrl?: string | null;
          expectedWebhooks?: string[];
          message?: string;
        }
      | null = null;

    try {
      const planoOuCombo = matricula.combo ?? matricula.plano;
      const periodicidade = (planoOuCombo?.periodicidade ?? PeriodicidadePlano.MENSAL) as PeriodicidadePlano;
      const cycle = mapPeriodicidadeToCycle(periodicidade);
      const mensalidade = matricula.cobrancas?.[0] ?? null;
      const billingType = mapFormaPagamentoToBillingType(
        mensalidade?.formaPagamento ?? matricula.formaPagamento ?? null,
      );
      const mensalidadeValue =
        mensalidade?.valor != null
          ? Number(mensalidade.valor)
          : calcularPrecoMatricula({
              planoValor: Number(planoOuCombo?.valor ?? 0),
              descontos: (matricula.descontos ?? []).map((item) => ({
                tipo: item.desconto.tipo === 'PERCENTUAL' ? 'PERCENTUAL' : 'FIXO',
                valor: Number(item.desconto.valor),
              })),
            }).planoLiquido;

      const existingSubscription = await prisma.subscription.findFirst({
        where: {
          contaId: user.contaId,
          matriculaId: matricula.id,
        },
        select: {
          id: true,
          contratoId: true,
          asaasSubscriptionId: true,
        },
      });

      if (matricula.asaasSubscriptionId) {
        if (existingSubscription && existingSubscription.contratoId !== contrato.id) {
          await prisma.subscription.update({
            where: { id: existingSubscription.id },
            data: { contratoId: contrato.id },
          });
        } else if (!existingSubscription) {
          const referencePlanId = matricula.combo?.id ?? matricula.plano?.id ?? contrato.id;
          await prisma.subscription.create({
            data: {
              contaId: user.contaId,
              contratoId: contrato.id,
              matriculaId: matricula.id,
              externalReference: buildSubscriptionExternalReference({
                matriculaId: matricula.id,
                planoId: referencePlanId,
              }),
              asaasSubscriptionId: matricula.asaasSubscriptionId,
              status: 'REQUESTED',
              statusUpdatedAt: new Date(),
            },
          });
        }

        const materializedPayment =
          mensalidade && !mensalidade.asaasPaymentId
            ? await materializeSubscriptionPaymentForCharge({
                prisma,
                contaId: user.contaId,
                asaasSubscriptionId: matricula.asaasSubscriptionId,
                cobranca: {
                  id: mensalidade.id,
                  vencimento: mensalidade.vencimento,
                  asaasPaymentId: mensalidade.asaasPaymentId,
                },
                intent: 'RECONCILIATION',
              })
            : null;

        subscriptionSync = {
          success: true,
          asaasSubscriptionId: matricula.asaasSubscriptionId,
          asaasPaymentId:
            materializedPayment?.payment?.id ??
            mensalidade?.asaasPaymentId ??
            null,
          invoiceUrl: materializedPayment?.payment?.invoiceUrl ?? null,
          bankSlipUrl: materializedPayment?.payment?.bankSlipUrl ?? null,
          expectedWebhooks:
            mensalidade?.asaasPaymentId || materializedPayment?.found
              ? []
              : ['PAYMENT_CREATED'],
          message:
            materializedPayment?.found
              ? 'A cobrança recorrente já existia e o primeiro payment foi reconciliado diretamente com o Asaas.'
              : 'A cobrança recorrente já foi solicitada na finalização da matrícula. O primeiro ciclo será materializado pelo webhook oficial do Asaas.',
        };
      } else if (!billingType || mensalidadeValue <= 0) {
        subscriptionSync = {
          success: false,
          error: mensalidadeValue <= 0
            ? 'VALOR_ASSINATURA_INVALIDO'
            : 'FORMA_PAGAMENTO_INVALIDA',
        };
      } else {
        const nextDueDateObj = resolveFirstDueDate(matricula.dataInicio, matricula.vencimentoDia);
        const nextDueDate = formatIsoDate(nextDueDateObj);
        const endDateObj = matricula.dataFimContrato;
        const endDate = endDateObj >= nextDueDateObj ? formatIsoDate(endDateObj) : undefined;

        const description = planoOuCombo?.nome
          ? `Mensalidade - ${planoOuCombo.nome}`
          : 'Mensalidade';

        const discountValue = matricula.descontoAntecipado ? Number(matricula.descontoAntecipado) : 0;
        const discount = discountValue > 0
          ? {
              value: discountValue,
              dueDateLimitDays: matricula.prazoDesconto ?? 0,
              type: (matricula.descontoTipo ?? 'PERCENTAGE') as 'FIXED' | 'PERCENTAGE',
            }
          : undefined;

        const interestValue = matricula.jurosMensal ? Number(matricula.jurosMensal) : 0;
        const fineValue = matricula.multaPercentual ? Number(matricula.multaPercentual) : 0;

        const result = await createSubscription({
          contaId: user.contaId,
          contratoId: contrato.id,
          matriculaId: matricula.id,
          value: mensalidadeValue,
          nextDueDate,
          billingType,
          cycle,
          description,
          endDate,
          discount,
          interest: interestValue > 0 ? { value: interestValue } : undefined,
          fine:
            fineValue > 0
              ? {
                  value: fineValue,
                  type: (matricula.multaTipo ?? 'PERCENTAGE') as 'FIXED' | 'PERCENTAGE',
                }
              : undefined,
          actor: { type: 'USER', id: user.id },
        });

        if (!result.success) {
          subscriptionSync = { success: false, error: result.error };
        } else {
          subscriptionSync = {
            success: true,
            asaasSubscriptionId: result.data.asaasSubscriptionId ?? null,
            asaasPaymentId: null,
            invoiceUrl: null,
            bankSlipUrl: null,
            expectedWebhooks: ['SUBSCRIPTION_CREATED', 'PAYMENT_CREATED'],
            message: 'A assinatura foi criada no Asaas. O primeiro ciclo será materializado pelo webhook oficial.',
          };
        }
      }
    } catch (syncError) {
      subscriptionSync = {
        success: false,
        error:
          syncError instanceof Error ? syncError.message : 'ERRO_SINCRONIZAR_ASSINATURA',
      };
    }

    const hydratedContrato = await getContratoWithRelations(contrato.id, user.contaId);

    if (!hydratedContrato) {
      return NextResponse.json(
        { error: { message: 'Contrato não encontrado após criação' } },
        { status: 500 },
      );
    }

    return NextResponse.json(
      mapContratoRecordToDTO(hydratedContrato, {
        subscriptionSync: subscriptionSync ?? null,
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

    return NextResponse.json(
      { error: { message: 'Erro ao gerar contrato' } },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { FormaPagamento, Prisma, StatusCobranca, StatusMatricula } from '@prisma/client';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import { contaFormaPagamentoResultDTOSchema } from '@/features/conta/dtos';
import { mapContaFormaPagamentoResultToDTO } from '@/features/conta/mappers';

const billingTypeMap: Record<string, FormaPagamento> = {
  BOLETO: FormaPagamento.BOLETO,
  PIX: FormaPagamento.PIX,
  CREDIT_CARD: FormaPagamento.CARTAO_CREDITO,
  CARTAO_CREDITO: FormaPagamento.CARTAO_CREDITO,
  DINHEIRO: FormaPagamento.INDEFINIDO,
};

const activeChargeStatuses = new Set<StatusCobranca>([
  StatusCobranca.A_VENCER,
  StatusCobranca.PENDENTE,
  StatusCobranca.ATRASADO,
  StatusCobranca.PROCESSANDO,
]);

const activeMatriculaStatuses: StatusMatricula[] = [
  StatusMatricula.ATIVA,
  StatusMatricula.AGUARDANDO_CONFIRMACAO,
  StatusMatricula.PENDENTE_TAXA,
];

type ResponsavelResumo = {
  id: string;
  nome: string;
  email: string;
  preferredBillingType: string | null;
};

function resolveFormaPagamento(
  cobrancas: Array<{
    id: string;
    status: StatusCobranca;
    vencimento: Date;
    valor: Prisma.Decimal | null;
    formaPagamento: FormaPagamento;
    tipo?: string | null;
  }>,
  matriculaFormaPagamento: FormaPagamento | null,
  fallback: FormaPagamento,
) {
  const cobrancasMensalidade = cobrancas.filter(
    (cobranca) => cobranca.tipo === 'MENSALIDADE' || cobranca.tipo === 'RECORRENTE',
  );

  const source = cobrancasMensalidade.length > 0 ? cobrancasMensalidade : cobrancas;

  const upcoming = [...source]
    .sort((a, b) => a.vencimento.getTime() - b.vencimento.getTime())
    .find((cobranca) => activeChargeStatuses.has(cobranca.status));

  const reference = upcoming ?? source[source.length - 1];
  const resolvedForma = reference?.formaPagamento ?? matriculaFormaPagamento ?? fallback;

  return {
    formaPagamento: resolvedForma,
    proximaCobranca: reference
      ? {
          id: reference.id,
          status: reference.status,
          vencimento: reference.vencimento,
          valor: reference.valor !== null ? Number(reference.valor) : null,
        }
      : null,
  };
}

export async function GET(_req: NextRequest) {
  try {
    //1. Autenticação
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const user = session.user as { id: string; role: string; contaId: string };

    if (!['RESPONSAVEL', 'ALUNO'].includes(user.role)) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    let responsavel: ResponsavelResumo | null = null;
    if (user.role === 'RESPONSAVEL') {
      responsavel = await prisma.responsavel.findFirst({
        where: {
          usuarioId: user.id,
          contaId: user.contaId,
        },
        select: {
          id: true,
          nome: true,
          email: true,
          preferredBillingType: true,
        },
      });

      if (!responsavel) {
        return NextResponse.json({ error: 'Responsável não encontrado' }, { status: 404 });
      }
    } else {
      const alunoRecord = await prisma.aluno.findFirst({
        where: { usuarioId: user.id },
        select: { id: true },
      });

      if (!alunoRecord) {
        return NextResponse.json({ error: 'Aluno não encontrado' }, { status: 404 });
      }

    }

    const matriculas = await prisma.matricula.findMany({
      where:
        user.role === 'RESPONSAVEL'
          ? {
              status: { in: activeMatriculaStatuses },
              OR: [
                { responsavelFinanceiroId: responsavel!.id },
                {
                  aluno: {
                    responsaveis: {
                      some: {
                        responsavelId: responsavel!.id,
                      },
                    },
                  },
                },
              ],
            }
          : {
              status: { in: activeMatriculaStatuses },
              aluno: {
                usuarioId: user.id,
              },
            },
      select: {
        id: true,
        asaasSubscriptionId: true,
        formaPagamento: true,
        formaPagamentoTaxa: true,
        responsavelFinanceiroId: true,
        status: true,
        responsavelFinanceiro: {
          select: {
            id: true,
            nome: true,
            email: true,
            preferredBillingType: true,
          },
        },
        aluno: {
          select: {
            nome: true,
            cpf: true,
            responsaveis: {
              select: {
                responsavel: {
                  select: {
                    id: true,
                    nome: true,
                    email: true,
                    preferredBillingType: true,
                  },
                },
              },
            },
          },
        },
        plano: {
          select: {
            nome: true,
          },
        },
        cobrancas: {
          select: {
            id: true,
            status: true,
            vencimento: true,
            valor: true,
            formaPagamento: true,
            tipo: true,
          },
          orderBy: {
            vencimento: 'asc',
          },
          take: 10,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    if (user.role === 'ALUNO' && !responsavel) {
      const financeFromMatriculas = matriculas.find((matricula) => matricula.responsavelFinanceiro)
        ?.responsavelFinanceiro;

      const fallbackFromResponsaveis = matriculas
        .flatMap((matricula) => matricula.aluno.responsaveis || [])
        .map((relacao) => relacao.responsavel)
        .find((relacao): relacao is { id: string; nome: string; email: string; preferredBillingType: string | null } =>
          Boolean(relacao),
        );

      const finance = financeFromMatriculas ?? fallbackFromResponsaveis ?? null;

      responsavel = finance
        ? {
            id: finance.id,
            nome: finance.nome,
            email: finance.email,
            preferredBillingType: finance.preferredBillingType,
          }
        : null;
    }

    const resolvedPreferred = (responsavel?.preferredBillingType || 'BOLETO').toUpperCase();
    const fallbackFormaPagamento = billingTypeMap[resolvedPreferred] || FormaPagamento.BOLETO;

    const assinaturas = matriculas.map((matricula) => {
      const cobrancas = matricula.cobrancas ?? [];
      const { formaPagamento, proximaCobranca } = resolveFormaPagamento(
        cobrancas,
        matricula.formaPagamento ?? matricula.formaPagamentoTaxa ?? null,
        fallbackFormaPagamento,
      );

      return {
        id: matricula.id,
        asaasSubscriptionId: matricula.asaasSubscriptionId,
        aluno: matricula.aluno.nome,
        cpf: matricula.aluno.cpf,
        plano: matricula.plano?.nome ?? 'Sem plano',
        status: matricula.status,
        formaPagamento,
        proximaCobranca,
      };
    });

    return NextResponse.json(
      contaFormaPagamentoResultDTOSchema.parse(mapContaFormaPagamentoResultToDTO({
      responsavel: responsavel
        ? {
            id: responsavel.id,
            nome: responsavel.nome,
            email: responsavel.email,
          }
        : null,
      assinaturas,
      })),
    );
  } catch (error) {
    console.error('Erro ao buscar forma de pagamento:', error);
    return NextResponse.json(
      { error: 'Erro ao buscar forma de pagamento' }, 
      { status: 500 }
    );
  }
}



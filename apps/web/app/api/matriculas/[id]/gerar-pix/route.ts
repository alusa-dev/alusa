import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { createAsaasPayment, formatDate, getAsaasPaymentDetails, KycNotApprovedError } from '@alusa/finance';
import { ensureAsaasCustomerForPayer } from '@alusa/lib';
import { matriculaGerarPixResultDTOSchema, matriculaRouteParamsDTOSchema } from '@/features/cadastro/matriculas/dtos';
import { mapMatriculaGerarPixResultToDTO } from '@/features/cadastro/matriculas/mappers';

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.contaId) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const { id: matriculaId } = matriculaRouteParamsDTOSchema.parse(params);
    const { contaId } = session.user;

    // Buscar matrícula com cobrança de taxa - MULTI-TENANT
    const matricula = await prisma.matricula.findFirst({
      where: { id: matriculaId, aluno: { contaId } },
      include: {
        aluno: {
          include: {
            responsaveis: {
              include: {
                responsavel: true,
              },
            },
          },
        },
        responsavelFinanceiro: true,
        cobrancas: {
          where: {
            tipo: 'TAXA_MATRICULA',
            status: 'PENDENTE',
          },
        },
      },
    });

    if (!matricula) {
      return NextResponse.json({ error: 'Matrícula não encontrada' }, { status: 404 });
    }

    if (matricula.taxaIsenta) {
      return NextResponse.json({ error: 'Taxa de matrícula isenta' }, { status: 400 });
    }

    const taxaCobranca = matricula.cobrancas[0];

    if (!taxaCobranca) {
      return NextResponse.json({ error: 'Nenhuma cobrança pendente' }, { status: 400 });
    }

    const aluno = matricula.aluno;

    // Calcular idade do aluno
    const hoje = new Date();
    const dataNasc = new Date(aluno.dataNasc);
    const idade = hoje.getFullYear() - dataNasc.getFullYear();
    const isMaiorDeIdade = idade >= 18;

    // Definir pagador
    const responsavel = isMaiorDeIdade
      ? null
      : matricula.responsavelFinanceiro || aluno.responsaveis[0]?.responsavel;

    const pagador = isMaiorDeIdade
      ? {
          id: aluno.id,
          nome: aluno.nome,
          cpf: aluno.cpf!,
          email: aluno.email!,
          telefone: aluno.telefone!,
          asaasCustomerId: aluno.asaasCustomerId,
        }
      : responsavel!;

    if (!pagador || !pagador.cpf || !pagador.email) {
      return NextResponse.json({ error: 'Dados do pagador incompletos' }, { status: 400 });
    }

    let customerId = pagador.asaasCustomerId;

    if (!customerId) {
      const created = await ensureAsaasCustomerForPayer({
        contaId,
        payer: {
          type: isMaiorDeIdade ? 'ALUNO' : 'RESPONSAVEL',
          id: pagador.id,
          name: pagador.nome,
          cpfCnpj: pagador.cpf,
          email: pagador.email,
          phone: pagador.telefone,
          mobilePhone: pagador.telefone,
        },
        persist: true,
      });

      if (!created.ok) {
        return NextResponse.json({ error: created.message }, { status: 500 });
      }

      customerId = created.customerId;
    }

    // Verificar se já tem cobrança no Asaas
    let asaasPaymentId = taxaCobranca.asaasPaymentId;

    if (!asaasPaymentId) {
      const createdPayment = await createAsaasPayment({
        contaId,
        customer: customerId,
        billingType: 'PIX',
        value: Number(taxaCobranca.valor),
        dueDate: formatDate(taxaCobranca.vencimento),
        description: 'Taxa de Matrícula',
        externalReference: taxaCobranca.id,
      });

      if (!createdPayment.success) {
        if (createdPayment.error === 'KYC_NAO_APROVADO') {
          return NextResponse.json(
            { error: 'KYC_NAO_APROVADO', message: 'Conta não aprovada para operações financeiras' },
            { status: 409 },
          );
        }

        return NextResponse.json({ error: createdPayment.error }, { status: 500 });
      }

      asaasPaymentId = createdPayment.data.id;

      // Atualizar cobrança no banco
      await prisma.cobranca.update({
        where: { id: taxaCobranca.id },
        data: {
          asaasPaymentId,
          formaPagamento: 'PIX',
        },
      });
    }

    const { pixQrCode } = await getAsaasPaymentDetails({
      contaId,
      paymentId: asaasPaymentId,
      includePixQrCode: true,
    });

    if (!pixQrCode) {
      return NextResponse.json({ error: 'QR Code PIX indisponível' }, { status: 502 });
    }

    return NextResponse.json(
      matriculaGerarPixResultDTOSchema.parse(
        mapMatriculaGerarPixResultToDTO({
          success: true,
          pixId: asaasPaymentId,
          cobrancaId: taxaCobranca.id,
          matriculaId: matricula.id,
          qrCode: pixQrCode.encodedImage,
          payload: pixQrCode.payload,
          valor: Number(taxaCobranca.valor),
          vencimento: taxaCobranca.vencimento,
        }),
      ),
    );
  } catch (error) {
    if (error instanceof KycNotApprovedError) {
      return NextResponse.json(
        { error: 'KYC_NAO_APROVADO', message: 'Conta não aprovada para operações financeiras' },
        { status: 409 },
      );
    }

    console.error('[Gerar PIX] Erro:', error);
    return NextResponse.json(
      { error: 'Erro ao gerar PIX', details: (error as Error).message },
      { status: 500 },
    );
  }
}

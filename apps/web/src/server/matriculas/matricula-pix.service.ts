import prisma from '@/lib/prisma';
import {
  createAsaasPayment,
  ensureAsaasCustomerForPayer,
  findCustomerForPayer,
  formatDate,
  getAsaasPaymentDetails,
} from '@alusa/finance';

export type MatriculaPixActionResult =
  | { ok: false; status: number; error: string; message?: string }
  | { ok: true; pixId: string; cobrancaId: string; matriculaId: string; qrCode: string; payload: string; valor: number; vencimento: Date };

export async function generateMatriculaPix(input: { matriculaId: string; contaId: string }): Promise<MatriculaPixActionResult> {
  const matricula = await prisma.matricula.findFirst({
    where: { id: input.matriculaId, contaId: input.contaId },
    include: {
      aluno: { include: { responsaveis: { include: { responsavel: true } } } },
      responsavelFinanceiro: true,
      cobrancas: { where: { tipo: 'TAXA_MATRICULA', status: 'PENDENTE' } },
    },
  });
  if (!matricula) return { ok: false, status: 404, error: 'MATRICULA_NAO_ENCONTRADA', message: 'Matrícula não encontrada' };
  if (matricula.taxaIsenta) return { ok: false, status: 400, error: 'TAXA_ISENTA', message: 'Taxa de matrícula isenta' };
  const taxaCobranca = matricula.cobrancas[0];
  if (!taxaCobranca) return { ok: false, status: 400, error: 'COBRANCA_NAO_ENCONTRADA', message: 'Nenhuma cobrança pendente' };

  const aluno = matricula.aluno;
  const dataNasc = new Date(aluno.dataNasc);
  const hoje = new Date();
  const idade = hoje.getFullYear() - dataNasc.getFullYear();
  const maior = idade >= 18;
  const responsavel = maior ? null : matricula.responsavelFinanceiro || aluno.responsaveis[0]?.responsavel;
  const pagador = maior
    ? { id: aluno.id, nome: aluno.nome, cpf: aluno.cpf, email: aluno.email, telefone: aluno.telefone, asaasCustomerId: aluno.asaasCustomerId }
    : responsavel;
  if (!pagador?.cpf || !pagador.email) return { ok: false, status: 400, error: 'PAGADOR_INCOMPLETO', message: 'Dados do pagador incompletos' };

  const payerType = maior ? ('ALUNO' as const) : ('RESPONSAVEL' as const);
  const identity = await findCustomerForPayer(input.contaId, payerType, pagador.id);
  let asaasPaymentId = taxaCobranca.asaasPaymentId;
  let customerId = identity?.asaasCustomerId ?? pagador.asaasCustomerId;
  if (!customerId) {
    const created = await ensureAsaasCustomerForPayer({
      contaId: input.contaId,
      payer: { type: payerType, id: pagador.id, name: pagador.nome, cpfCnpj: pagador.cpf, email: pagador.email, phone: pagador.telefone, mobilePhone: pagador.telefone },
      persist: true,
    });
    if (!created.ok) return { ok: false, status: 500, error: 'CUSTOMER_CREATE_FAILED', message: created.message };
    customerId = created.customerId;
  }
  if (!asaasPaymentId) {
    const createdPayment = await createAsaasPayment({ contaId: input.contaId, customer: customerId, billingType: 'PIX', value: Number(taxaCobranca.valor), dueDate: formatDate(taxaCobranca.vencimento), description: 'Taxa de Matrícula', externalReference: taxaCobranca.id });
    if (!createdPayment.success) {
      if (createdPayment.error === 'KYC_NAO_APROVADO') return { ok: false, status: 409, error: 'KYC_NAO_APROVADO', message: 'Conta não aprovada para operações financeiras' };
      return { ok: false, status: 500, error: createdPayment.error };
    }
    asaasPaymentId = createdPayment.data.id;
    await prisma.cobranca.update({ where: { id: taxaCobranca.id, contaId: input.contaId }, data: { asaasPaymentId, formaPagamento: 'PIX' } });
  }
  const { pixQrCode } = await getAsaasPaymentDetails({ contaId: input.contaId, paymentId: asaasPaymentId, includePixQrCode: true });
  if (!pixQrCode) return { ok: false, status: 502, error: 'PIX_QR_CODE_UNAVAILABLE', message: 'QR Code PIX indisponível' };
  return { ok: true, pixId: asaasPaymentId, cobrancaId: taxaCobranca.id, matriculaId: matricula.id, qrCode: pixQrCode.encodedImage, payload: pixQrCode.payload, valor: Number(taxaCobranca.valor), vencimento: taxaCobranca.vencimento };
}

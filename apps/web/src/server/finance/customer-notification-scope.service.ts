import { prisma } from '@/lib/prisma';
import { findCustomerForPayer } from '@alusa/finance';

type CustomerScopeResult =
  | { status: 'NOT_FOUND' }
  | { status: 'FORBIDDEN_CUSTOMER' }
  | { status: 'NO_CUSTOMER' }
  | { status: 'OK'; customerId: string };

function addCustomerId(ids: Set<string>, customerId?: string | null) {
  const trimmed = customerId?.trim();
  if (trimmed) ids.add(trimmed);
}

export async function resolveAlunoNotificationCustomer(input: {
  alunoId: string;
  contaId: string;
  requestedCustomerId?: string | null;
}): Promise<CustomerScopeResult> {
  const aluno = await prisma.aluno.findFirst({
    where: { id: input.alunoId, contaId: input.contaId },
    select: {
      id: true,
      asaasCustomerId: true,
      responsaveis: {
        select: {
          responsavel: { select: { id: true, asaasCustomerId: true } },
        },
      },
      matriculas: {
        orderBy: { createdAt: 'desc' },
        select: {
          responsavelFinanceiro: {
            select: { id: true, asaasCustomerId: true },
          },
        },
      },
    },
  });

  if (!aluno) return { status: 'NOT_FOUND' };

  const payerRefs = [
    { payerType: 'ALUNO' as const, payerId: aluno.id, fallbackCustomerId: aluno.asaasCustomerId },
    ...aluno.responsaveis.map((item) => ({
      payerType: 'RESPONSAVEL' as const,
      payerId: item.responsavel.id,
      fallbackCustomerId: item.responsavel.asaasCustomerId,
    })),
    ...aluno.matriculas.flatMap((matricula) =>
      matricula.responsavelFinanceiro
        ? [{
            payerType: 'RESPONSAVEL' as const,
            payerId: matricula.responsavelFinanceiro.id,
            fallbackCustomerId: matricula.responsavelFinanceiro.asaasCustomerId,
          }]
        : [],
    ),
  ];

  const canonicalCustomers = await Promise.all(
    payerRefs.map((payer) => findCustomerForPayer(input.contaId, payer.payerType, payer.payerId)),
  );
  const allowedCustomerIds = new Set<string>();
  canonicalCustomers.forEach((customer, index) =>
    addCustomerId(
      allowedCustomerIds,
      customer?.asaasCustomerId ?? payerRefs[index]?.fallbackCustomerId,
    ),
  );

  const requested = input.requestedCustomerId?.trim();
  if (requested) {
    return allowedCustomerIds.has(requested)
      ? { status: 'OK', customerId: requested }
      : { status: 'FORBIDDEN_CUSTOMER' };
  }

  const customerId = [...allowedCustomerIds][0] ?? null;
  return customerId ? { status: 'OK', customerId } : { status: 'NO_CUSTOMER' };
}

export async function resolveResponsavelNotificationCustomer(input: {
  responsavelId: string;
  contaId: string;
  requestedCustomerId?: string | null;
}): Promise<CustomerScopeResult> {
  const responsavel = await prisma.responsavel.findFirst({
    where: { id: input.responsavelId, contaId: input.contaId },
    select: { id: true, asaasCustomerId: true },
  });

  if (!responsavel) return { status: 'NOT_FOUND' };

  const canonicalCustomer = await findCustomerForPayer(
    input.contaId,
    'RESPONSAVEL',
    responsavel.id,
  );
  const canonicalCustomerId = canonicalCustomer?.asaasCustomerId ?? responsavel.asaasCustomerId;
  const requested = input.requestedCustomerId?.trim();

  if (requested) {
    return requested === canonicalCustomerId
      ? { status: 'OK', customerId: requested }
      : { status: 'FORBIDDEN_CUSTOMER' };
  }

  return canonicalCustomerId
    ? { status: 'OK', customerId: canonicalCustomerId }
    : { status: 'NO_CUSTOMER' };
}

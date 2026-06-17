import type { Prisma } from '@prisma/client';

import { getFiscalPrisma } from './fiscal-prisma';
import { resolveInvoiceEffectiveDate } from './invoice-effective-date';
import {
  buildInvoiceDescriptionFromTemplate,
  DEFAULT_INVOICE_DESCRIPTION_TEMPLATE,
  type InvoiceDescriptionContext,
} from '../fiscal/invoice-description-template';

function formatCompetencia(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric', timeZone: 'UTC' });
  if (start.getTime() === end.getTime()) return fmt(start);
  return `${fmt(start)} – ${fmt(end)}`;
}

export async function resolveChargeInvoiceContext(chargeId: string, contaId: string) {
  const prisma = getFiscalPrisma();
  const charge = await prisma.charge.findFirst({
    where: { id: chargeId, contaId },
    select: {
      id: true,
      cobrancaId: true,
      asaasPaymentId: true,
      asaasStatus: true,
      status: true,
      value: true,
      dueDate: true,
      description: true,
      cobranca: {
        select: {
          id: true,
          matriculaId: true,
          competenciaInicio: true,
          competenciaFim: true,
          descricao: true,
          status: true,
          valor: true,
          valorFinal: true,
          vencimento: true,
          matricula: {
            select: {
              id: true,
              contratoAtual: { select: { id: true } },
              plano: { select: { nome: true } },
              aluno: { select: { id: true, nome: true } },
              turma: { select: { nome: true } },
              responsavelFinanceiro: { select: { id: true, nome: true } },
            },
          },
        },
      },
    },
  });

  if (!charge) return null;

  const matricula = charge.cobranca?.matricula;
  const responsavel = matricula?.responsavelFinanceiro;

  const chargeLabel =
    charge.cobranca?.descricao?.trim() || charge.description?.trim() || null;

  const context: InvoiceDescriptionContext = {
    aluno: matricula?.aluno.nome ?? chargeLabel,
    responsavel: responsavel?.nome ?? null,
    competencia: charge.cobranca
      ? formatCompetencia(charge.cobranca.competenciaInicio, charge.cobranca.competenciaFim)
      : null,
    matricula: matricula?.id ?? null,
    turma: matricula?.turma?.nome ?? null,
    plano: matricula?.plano?.nome ?? null,
    contrato: matricula?.contratoAtual?.id ?? null,
  };

  const value =
    charge.cobranca?.valorFinal != null
      ? Number(charge.cobranca.valorFinal)
      : charge.cobranca?.valor != null
        ? Number(charge.cobranca.valor)
        : charge.value != null
          ? Number(charge.value)
          : 0;

  const effectiveDate = resolveInvoiceEffectiveDate(
    charge.cobranca?.vencimento ?? charge.dueDate ?? null,
  );

  return {
    charge,
    context,
    value,
    effectiveDate,
    cobrancaId: charge.cobranca?.id ?? null,
    matriculaId: charge.cobranca?.matriculaId ?? null,
    responsavelId: responsavel?.id ?? null,
  };
}

export function buildChargeInvoiceTexts(input: {
  settings: {
    defaultDescriptionTemplate: string | null;
    defaultObservations: string | null;
    defaultDeductions: Prisma.Decimal | null;
  } | null;
  fiscalService: {
    defaultDescription: string | null;
    name: string;
  };
  context: InvoiceDescriptionContext;
  overrides?: {
    serviceDescription?: string;
    observations?: string;
    deductions?: number;
  };
}) {
  const template =
    input.settings?.defaultDescriptionTemplate?.trim() ||
    input.fiscalService.defaultDescription?.trim() ||
    DEFAULT_INVOICE_DESCRIPTION_TEMPLATE;

  const builtDescription = buildInvoiceDescriptionFromTemplate(template, input.context);
  const serviceDescription =
    input.overrides?.serviceDescription?.trim() ||
    builtDescription ||
    input.fiscalService.defaultDescription?.trim() ||
    input.fiscalService.name;

  const observations =
    input.overrides?.observations?.trim() ||
    input.settings?.defaultObservations?.trim() ||
    '';

  const deductions =
    input.overrides?.deductions ??
    (input.settings?.defaultDeductions != null ? Number(input.settings.defaultDeductions) : 0);

  return { serviceDescription, observations, deductions };
}

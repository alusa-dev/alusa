import type { FinancePayerCandidateDTO } from '@/features/finance/dtos';

interface SelectedSaleCustomerSummaryProps {
  customer: FinancePayerCandidateDTO;
}

export function SelectedSaleCustomerSummary({ customer }: SelectedSaleCustomerSummaryProps) {
  const displayName = customer.salesDisplayName ?? customer.name;
  const studentCount = customer.salesStudentCount ?? (customer.type === 'aluno' ? 1 : 0);
  const badgeLabel = studentCount > 1 ? 'Alunos' : studentCount === 1 ? 'Aluno' : null;
  const payerTypeLabel = customer.payerResolved.type === 'responsavel' ? 'Responsável financeiro' : 'Aluno';

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-sm">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <p className="min-w-0 flex-1 break-words text-base font-semibold text-slate-900">{displayName}</p>
        {badgeLabel ? (
          <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
            {badgeLabel}
          </span>
        ) : null}
      </div>

      <div className="border-t border-slate-200 pt-3">
        <p className="text-xs font-medium text-slate-500">{customer.isMinor && !customer.hasResponsible ? 'Cliente da venda' : 'Cobrança em nome de'}</p>
        <p className="mt-0.5 font-medium text-slate-800">{customer.payerResolved.name}</p>
        <p className="text-xs text-slate-500">{payerTypeLabel}</p>
      </div>

      {customer.financialStatus === 'INCOMPLETE' ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {customer.isMinor && !customer.hasResponsible
            ? 'Venda à vista permitida. Para gerar uma cobrança, cadastre um responsável financeiro para este aluno.'
            : 'Cadastro financeiro incompleto. Para gerar cobrança, complete os dados do pagador no cadastro.'}
        </p>
      ) : null}
    </div>
  );
}

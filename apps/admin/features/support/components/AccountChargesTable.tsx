'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Icon } from '@/components/icons/Icon';
import { compactId, formatCurrency, formatSupportStatus } from '@/features/support/shared/format';
import { StatusBadge } from '@/features/support/shared/SupportUI';

const PAGE_SIZE = 7;

export type AccountChargeRow = {
  id: string;
  asaasPaymentId: string | null;
  value: number;
  chargeType: string | null;
  billingType: string | null;
  status: string;
};

export function AccountChargesTable({ contaId, charges }: { contaId: string; charges: AccountChargeRow[] }) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(charges.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const visibleCharges = charges.slice(pageStart, pageStart + PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [charges.length]);

  function openCharge(chargeId: string) {
    router.push(`/contas/${encodeURIComponent(contaId)}/financeiro/cobrancas/${encodeURIComponent(chargeId)}`);
  }

  return (
    <div className="account-charges-table-wrap">
      <table className="account-charges-table" aria-label="Todas as cobranças da conta">
        <thead>
          <tr>
            <th scope="col">ID da cobrança</th>
            <th scope="col">Valor</th>
            <th scope="col">Tipo</th>
            <th scope="col">Status</th>
            <th scope="col" className="account-charges-table-action-heading"><span className="sr-only">Ações</span></th>
          </tr>
        </thead>
        <tbody>
          {charges.length > 0 ? visibleCharges.map((charge) => (
            <tr
              key={charge.id}
              tabIndex={0}
              role="link"
              onClick={() => openCharge(charge.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openCharge(charge.id);
                }
              }}
              className="account-charges-table-row"
            >
              <td><span className="account-charges-id">{compactId(charge.asaasPaymentId ?? charge.id)}</span></td>
              <td>{formatCurrency(charge.value)}</td>
              <td>{formatSupportStatus(charge.billingType ?? charge.chargeType)}</td>
              <td><StatusBadge value={charge.status} /></td>
              <td className="account-charges-table-action">
                <button type="button" aria-label={`Ver cobrança ${compactId(charge.asaasPaymentId ?? charge.id)}`} onClick={(event) => { event.stopPropagation(); openCharge(charge.id); }}>
                  <Icon name="Eye" size={17} aria-hidden="true" />
                </button>
              </td>
            </tr>
          )) : (
            <tr><td colSpan={5} className="account-charges-empty">Nenhuma cobrança encontrada.</td></tr>
          )}
        </tbody>
      </table>
      {charges.length > 0 ? (
        <nav className="account-charges-pagination" aria-label="Paginação de cobranças">
          <span aria-live="polite">{pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, charges.length)} de {charges.length}</span>
          <div>
            <button
              type="button"
              aria-label="Página anterior"
              disabled={currentPage === 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              <Icon name="ChevronRight" size={16} className="account-charges-pagination-previous" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Próxima página"
              disabled={currentPage === totalPages}
              onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            >
              <Icon name="ChevronRight" size={16} aria-hidden="true" />
            </button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}

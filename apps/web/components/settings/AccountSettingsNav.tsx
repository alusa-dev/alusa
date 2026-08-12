'use client';

import React from 'react';
import { useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { resolveFinancialCapabilities } from '@/lib/finance/financial-capabilities';

type Item = { href: string; label: string; requiresFinance?: boolean };

const KYC_ITEMS: Item[] = [
  { href: '/conta/verificacao', label: 'Situação cadastral', requiresFinance: true },
];

const PAYMENT_ALLOWED_ROLES = new Set(['RESPONSAVEL', 'ALUNO']);
const PLATFORM_BILLING_ALLOWED_ROLES = new Set(['ADMIN', 'FINANCEIRO']);

export default function AccountSettingsNav() {
  const pathname = usePathname();
  const { data } = useSession();
  const user = data?.user as {
    role?: string;
    financeStatus?: string;
    financeIntegrationMode?: string;
    contaId?: string;
  } | undefined;

  const role = user?.role;
  const normalizedRole = role?.toUpperCase() ?? '';
  const financialCapabilities = resolveFinancialCapabilities(user?.financeIntegrationMode);
  const showPaymentSection = role ? PAYMENT_ALLOWED_ROLES.has(role) : false;
  const isAdmin = normalizedRole === 'ADMIN';
  const canDeleteAccount = isAdmin;
  const showPlatformBilling = PLATFORM_BILLING_ALLOWED_ROLES.has(normalizedRole);

  const items = useMemo(() => {
    const result: Item[] = [
      { href: '/conta/perfil', label: 'Perfil' },
      { href: '/conta/seguranca', label: 'Segurança' },
    ];

    if (showPaymentSection) {
      result.push({ href: '/conta/assinaturas', label: 'Assinaturas' });
    }

    // A situação cadastral deve continuar acessível mesmo enquanto a sessão
    // ainda carrega o financeStatus atualizado após o onboarding. A página
    // própria resolve o estado (aguardando, pendente ou aprovado).
    if (isAdmin && financialCapabilities.canUseKyc) {
      result.push(...KYC_ITEMS);
    }

    if (showPlatformBilling) {
      result.push({ href: '/conta/plano-faturamento', label: 'Plano e faturamento' });
    }

    if (canDeleteAccount) {
      result.push({ href: '/conta/excluir-conta', label: 'Desativar conta' });
    }

    return result;
  }, [
    canDeleteAccount,
    financialCapabilities.canUseKyc,
    isAdmin,
    showPaymentSection,
    showPlatformBilling,
  ]);

  return (
    <nav aria-label="Navegação Minha Conta" data-testid="account-card-nav" className="w-full md:w-[191px]">
      <ul className="space-y-2.5">
        {items.map((item) => {
          const active = pathname?.startsWith(item.href);

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={[
                  'flex h-[35px] w-full items-center rounded-[7px] px-[21px] text-sm transition-colors duration-150',
                  active
                    ? 'bg-[#f9f0ff] font-medium text-[#361D56] alusa-dark:bg-[color:rgba(169,77,255,0.18)] alusa-dark:text-[color:var(--color-text-primary)]'
                    : 'bg-transparent text-[#1d1830] hover:bg-[#fbf7ff] alusa-dark:text-[color:var(--color-text-secondary)] alusa-dark:hover:bg-[color:rgba(255,255,255,0.06)]',
                  'focus:outline-none focus:ring-0',
                ].join(' ')}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

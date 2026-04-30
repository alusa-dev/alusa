'use client';
// Necessário para transformar JSX em ambiente sem automatic runtime completo
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React, { useMemo } from 'react';
void React;

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';

type Item = { href: string; label: string; requiresFinance?: boolean };

const BASE_ITEMS: Item[] = [
  { href: '/conta/perfil', label: 'Perfil' },
  { href: '/conta/seguranca', label: 'Segurança' },
  { href: '/conta/assinaturas', label: 'Assinaturas' },
];

// Itens do módulo KYC/financeiro — visíveis apenas para ADMIN com fluxo financeiro iniciado
const KYC_ITEMS: Item[] = [
  { href: '/conta/verificacao', label: 'Verificação da conta', requiresFinance: true },
];

const PAYMENT_ALLOWED_ROLES = new Set(['RESPONSAVEL', 'ALUNO']);

export default function AccountSettingsNav() {
  const pathname = usePathname();
  const { data } = useSession();
  const user = data?.user as { role?: string; financeStatus?: string; contaId?: string } | undefined;
  const role = user?.role;
  const financeStatus = user?.financeStatus;
  const showPaymentSection = role ? PAYMENT_ALLOWED_ROLES.has(role) : false;

  const normalizedRole = role?.toUpperCase() ?? '';
  const isAdmin = normalizedRole === 'ADMIN';
  const canDeleteAccount = isAdmin;

  // Verifica se o fluxo financeiro foi iniciado
  const hasFinanceFlow = useMemo(() => {
    if (!financeStatus) return false;
    // Se não for FINANCE_NOT_STARTED, significa que o fluxo financeiro foi iniciado
    return financeStatus !== 'FINANCE_NOT_STARTED';
  }, [financeStatus]);

  const itemsWithDelete: Item[] = canDeleteAccount
    ? (() => {
        const insertAfterHref = '/conta/seguranca';
        const insertIndex = BASE_ITEMS.findIndex((it) => it.href === insertAfterHref);
        const next = [...BASE_ITEMS];
        const deleteItem: Item = { href: '/conta/excluir-conta', label: 'Desativar conta' };
        if (insertIndex === -1) return [...next, deleteItem];
        next.splice(insertIndex + 1, 0, deleteItem);
        return next;
      })()
    : BASE_ITEMS;

  // Adiciona itens KYC para ADMIN com fluxo financeiro iniciado
  const itemsWithKyc: Item[] = useMemo(() => {
    if (!isAdmin || !hasFinanceFlow) return itemsWithDelete;
    // Insere os itens KYC após "Segurança" e antes de "Excluir conta"
    const insertAfterHref = '/conta/seguranca';
    const insertIndex = itemsWithDelete.findIndex((it) => it.href === insertAfterHref);
    const result = [...itemsWithDelete];
    if (insertIndex === -1) {
      // Adiciona no final, mas antes de "Excluir conta" se existir
      const deleteIndex = result.findIndex((it) => it.href === '/conta/excluir-conta');
      if (deleteIndex !== -1) {
        result.splice(deleteIndex, 0, ...KYC_ITEMS);
      } else {
        result.push(...KYC_ITEMS);
      }
    } else {
      result.splice(insertIndex + 1, 0, ...KYC_ITEMS);
    }
    return result;
  }, [isAdmin, hasFinanceFlow, itemsWithDelete]);

  const items = showPaymentSection
    ? itemsWithKyc
    : itemsWithKyc.filter((item) => item.href !== '/conta/assinaturas');

  return (
    <nav aria-label="Navegação Minha Conta" data-testid="account-card-nav">
      <ul className="space-y-2">
        {items.map((it) => {
          const active = pathname?.startsWith(it.href);
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={active ? 'page' : undefined}
                className={[
                  'flex w-full items-center rounded-lg px-3 py-2 text-sm transition-colors duration-150',
                  active
                    ? 'bg-purple-50 text-purple-700 font-medium'
                    : 'bg-white text-gray-700 hover:bg-gray-50',
                  'focus:outline-none focus:ring-0',
                ].join(' ')}
              >
                {it.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

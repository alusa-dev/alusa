'use client';

import type { ReactNode } from 'react';
import {
  AcademicCapIcon,
  UserIcon,
  UsersIcon,
  BookOpenIcon,
  BuildingLibraryIcon,
  RectangleStackIcon,
  ClipboardDocumentCheckIcon,
  BanknotesIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  ShoppingBagIcon,
  ShoppingCartIcon,
  ClockIcon,
  CubeIcon,
  CircleStackIcon,
  ArrowPathRoundedSquareIcon,
  TagIcon,
  TicketIcon,
  AcademicCapSolid,
  UserSolid,
  UsersSolid,
  BookOpenSolid,
  BuildingLibrarySolid,
  RectangleStackSolid,
  ClipboardDocumentCheckSolid,
  BanknotesSolid,
  CalendarDaysSolid,
  ChartBarSolid,
  ShoppingBagSolid,
  ShoppingCartSolid,
  ClockSolid,
  CubeSolid,
  CircleStackSolid,
  ArrowPathRoundedSquareSolid,
  TagSolid,
  TicketSolid,
  Receipt,
  WalletIcon,
  WalletSolid,
  DocumentText,
  DocumentDuplicate,
  DocumentTextSolid,
  DocumentDuplicateSolid,
} from '@/components/icons/icons';
import { resolveFinancialCapabilities } from '@/lib/finance/financial-capabilities';

export const FINANCE_LOCKED_GROUP_KEYS = new Set(['financeiro', 'meu-dinheiro', 'antecipacoes']);
export const AUTOMATIC_ANTICIPATION_ITEM_HREF = '/advances/automatic';

export type SidebarSubItem = {
  label: string;
  href: string;
  icon: ReactNode;
  iconSolid: ReactNode;
};

export type SidebarGroup = {
  key: string;
  label: string;
  icon: ReactNode;
  iconSolid: ReactNode;
  items: SidebarSubItem[];
  comingSoon?: boolean;
};

export type SidebarRoleKey =
  | 'ADMIN'
  | 'FINANCEIRO'
  | 'RECEPCAO'
  | 'PROFESSOR'
  | 'RESPONSAVEL'
  | 'ALUNO'
  | string;

export type SidebarPermissionSet = {
  allowDashboard: boolean;
  allowGroups: Array<{ key: string; items?: string[] }>;
  allowSettings?: boolean;
  allowPortal?: boolean;
};

export const SIDEBAR_GROUPS: SidebarGroup[] = [
  {
    key: 'cadastro',
    label: 'Cadastro',
    icon: <AcademicCapIcon className="h-5 w-5" />,
    iconSolid: <AcademicCapSolid className="h-5 w-5" />,
    items: [
      {
        label: 'Alunos',
        href: '/students',
        icon: <UserIcon className="h-5 w-5" />,
        iconSolid: <UserSolid className="h-5 w-5" />,
      },
      {
        label: 'Responsáveis',
        href: '/responsibles',
        icon: <UsersIcon className="h-5 w-5" />,
        iconSolid: <UsersSolid className="h-5 w-5" />,
      },
      {
        label: 'Colaboradores',
        href: '/employees',
        icon: <UsersIcon className="h-5 w-5" />,
        iconSolid: <UsersSolid className="h-5 w-5" />,
      },
      {
        label: 'Turmas',
        href: '/classes',
        icon: <BookOpenIcon className="h-5 w-5" />,
        iconSolid: <BookOpenSolid className="h-5 w-5" />,
      },
      {
        label: 'Planos',
        href: '/plans',
        icon: <RectangleStackIcon className="h-5 w-5" />,
        iconSolid: <RectangleStackSolid className="h-5 w-5" />,
      },
      {
        label: 'Combos',
        href: '/bundles',
        icon: <RectangleStackIcon className="h-5 w-5" />,
        iconSolid: <RectangleStackSolid className="h-5 w-5" />,
      },
      {
        label: 'Modalidades',
        href: '/programs',
        icon: <BookOpenIcon className="h-5 w-5" />,
        iconSolid: <BookOpenSolid className="h-5 w-5" />,
      },
      {
        label: 'Salas',
        href: '/rooms',
        icon: <BuildingLibraryIcon className="h-5 w-5" />,
        iconSolid: <BuildingLibrarySolid className="h-5 w-5" />,
      },
    ],
  },
  {
    key: 'matriculas',
    label: 'Matrículas',
    icon: <ClipboardDocumentCheckIcon className="h-5 w-5" />,
    iconSolid: <ClipboardDocumentCheckSolid className="h-5 w-5" />,
    items: [
      {
        label: 'Minhas Matrículas',
        href: '/enrollments',
        icon: <ClipboardDocumentCheckIcon className="h-5 w-5" />,
        iconSolid: <ClipboardDocumentCheckSolid className="h-5 w-5" />,
      },
      {
        label: 'Rematrículas',
        href: '/reenrollments',
        icon: <ClipboardDocumentCheckIcon className="h-5 w-5" />,
        iconSolid: <ClipboardDocumentCheckSolid className="h-5 w-5" />,
      },
    ],
  },
  {
    key: 'contratos',
    label: 'Contratos',
    icon: <DocumentText className="h-5 w-5" />,
    iconSolid: <DocumentTextSolid className="h-5 w-5" />,
    items: [
      {
        label: 'Gestão de Contratos',
        href: '/contracts',
        icon: <DocumentText className="h-5 w-5" />,
        iconSolid: <DocumentTextSolid className="h-5 w-5" />,
      },
      {
        label: 'Modelos',
        href: '/contracts/templates',
        icon: <DocumentDuplicate className="h-5 w-5" />,
        iconSolid: <DocumentDuplicateSolid className="h-5 w-5" />,
      },
    ],
  },
  {
    key: 'cobrancas',
    label: 'Cobranças',
    icon: <BanknotesIcon className="h-5 w-5" />,
    iconSolid: <BanknotesSolid className="h-5 w-5" />,
    items: [
      {
        label: 'Todas',
        href: '/charges',
        icon: <BanknotesIcon className="h-5 w-5" />,
        iconSolid: <BanknotesSolid className="h-5 w-5" />,
      },
      {
        label: 'Avulsas',
        href: '/charges/one-time',
        icon: <BanknotesIcon className="h-5 w-5" />,
        iconSolid: <BanknotesSolid className="h-5 w-5" />,
      },
      {
        label: 'Parcelamentos',
        href: '/charges/installments',
        icon: <RectangleStackIcon className="h-5 w-5" />,
        iconSolid: <RectangleStackSolid className="h-5 w-5" />,
      },
      {
        label: 'Assinaturas',
        href: '/charges/subscriptions',
        icon: <ClipboardDocumentCheckIcon className="h-5 w-5" />,
        iconSolid: <ClipboardDocumentCheckSolid className="h-5 w-5" />,
      },
      {
        label: 'Simulador de vendas',
        href: '/charges/sales-simulator',
        icon: <Receipt className="h-5 w-5" />,
        iconSolid: <Receipt className="h-5 w-5" />,
      },
    ],
  },
  {
    key: 'meu-dinheiro',
    label: 'Meu Dinheiro',
    icon: <WalletIcon className="h-5 w-5" />,
    iconSolid: <WalletSolid className="h-5 w-5" />,
    items: [
      {
        label: 'Saldo',
        href: '/finance/account',
        icon: <WalletIcon className="h-5 w-5" />,
        iconSolid: <WalletSolid className="h-5 w-5" />,
      },
      {
        label: 'Extrato',
        href: '/finance/statement',
        icon: <DocumentText className="h-5 w-5" />,
        iconSolid: <DocumentTextSolid className="h-5 w-5" />,
      },
    ],
  },
  {
    key: 'antecipacoes',
    label: 'Antecipações',
    icon: <BanknotesIcon className="h-5 w-5" />,
    iconSolid: <BanknotesSolid className="h-5 w-5" />,
    items: [
      {
        label: 'Minhas antecipações',
        href: '/advances/mine',
        icon: <DocumentText className="h-5 w-5" />,
        iconSolid: <DocumentTextSolid className="h-5 w-5" />,
      },
      {
        label: 'Antecipar recebimento',
        href: '/advances/request',
        icon: <BanknotesIcon className="h-5 w-5" />,
        iconSolid: <BanknotesSolid className="h-5 w-5" />,
      },
      {
        label: 'Antecipação automática',
        href: '/advances/automatic',
        icon: <ArrowPathRoundedSquareIcon className="h-5 w-5" />,
        iconSolid: <ArrowPathRoundedSquareSolid className="h-5 w-5" />,
      },
    ],
  },
  {
    key: 'financeiro',
    label: 'Financeiro',
    icon: <ChartBarIcon className="h-5 w-5" />,
    iconSolid: <ChartBarSolid className="h-5 w-5" />,
    items: [
      {
        label: 'Pagamentos',
        href: '/finance/payments',
        icon: <BanknotesIcon className="h-5 w-5" />,
        iconSolid: <BanknotesSolid className="h-5 w-5" />,
      },
      {
        label: 'Nota Fiscal',
        href: '/finance/tax-invoices',
        icon: <DocumentText className="h-5 w-5" />,
        iconSolid: <DocumentTextSolid className="h-5 w-5" />,
      },
      {
        label: 'Relatórios',
        href: '/finance/reports',
        icon: <ChartBarIcon className="h-5 w-5" />,
        iconSolid: <ChartBarSolid className="h-5 w-5" />,
      },
    ],
  },
  {
    key: 'aulas',
    label: 'Aulas',
    icon: <CalendarDaysIcon className="h-5 w-5" />,
    iconSolid: <CalendarDaysSolid className="h-5 w-5" />,
    items: [
      {
        label: 'Agenda',
        href: '/lessons/schedule',
        icon: <BookOpenIcon className="h-5 w-5" />,
        iconSolid: <BookOpenSolid className="h-5 w-5" />,
      },
      {
        label: 'Frequência',
        href: '/lessons/attendance',
        icon: <CalendarDaysIcon className="h-5 w-5" />,
        iconSolid: <CalendarDaysSolid className="h-5 w-5" />,
      },
      {
        label: 'Reposições de aula',
        href: '/lessons/replacements',
        icon: <CalendarDaysIcon className="h-5 w-5" />,
        iconSolid: <CalendarDaysSolid className="h-5 w-5" />,
      },
    ],
  },
  {
    key: 'vendas',
    label: 'Loja',
    icon: <ShoppingBagIcon className="h-5 w-5" />,
    iconSolid: <ShoppingBagSolid className="h-5 w-5" />,
    items: [
      {
        label: 'Nova Venda',
        href: '/sales/new',
        icon: <ShoppingCartIcon className="h-5 w-5" />,
        iconSolid: <ShoppingCartSolid className="h-5 w-5" />,
      },
      {
        label: 'Histórico',
        href: '/sales/history',
        icon: <ClockIcon className="h-5 w-5" />,
        iconSolid: <ClockSolid className="h-5 w-5" />,
      },
      {
        label: 'Produtos',
        href: '/sales/products',
        icon: <CubeIcon className="h-5 w-5" />,
        iconSolid: <CubeSolid className="h-5 w-5" />,
      },
      {
        label: 'Estoque',
        href: '/sales/inventory',
        icon: <CircleStackIcon className="h-5 w-5" />,
        iconSolid: <CircleStackSolid className="h-5 w-5" />,
      },
      {
        label: 'Reposições de estoque',
        href: '/sales/restocks',
        icon: <ArrowPathRoundedSquareIcon className="h-5 w-5" />,
        iconSolid: <ArrowPathRoundedSquareSolid className="h-5 w-5" />,
      },
      {
        label: 'Categorias',
        href: '/sales/categories',
        icon: <TagIcon className="h-5 w-5" />,
        iconSolid: <TagSolid className="h-5 w-5" />,
      },
    ],
  },
  {
    key: 'eventos',
    label: 'Eventos',
    icon: <TicketIcon className="h-5 w-5" />,
    iconSolid: <TicketSolid className="h-5 w-5" />,
    items: [
      {
        label: 'Todos os eventos',
        href: '/events',
        icon: <TicketIcon className="h-5 w-5" />,
        iconSolid: <TicketSolid className="h-5 w-5" />,
      },
      {
        label: 'Relatórios',
        href: '/events/reports',
        icon: <TicketIcon className="h-5 w-5" />,
        iconSolid: <TicketSolid className="h-5 w-5" />,
      },
    ],
  },
];

export const SIDEBAR_PORTAL_GROUPS: SidebarGroup[] = [
  {
    key: 'portal-matriculas',
    label: 'Matrículas',
    icon: <ClipboardDocumentCheckIcon className="h-5 w-5" />,
    iconSolid: <ClipboardDocumentCheckSolid className="h-5 w-5" />,
    items: [
      {
        label: 'Minhas Matrículas',
        href: '/portal/enrollments',
        icon: <ClipboardDocumentCheckIcon className="h-5 w-5" />,
        iconSolid: <ClipboardDocumentCheckSolid className="h-5 w-5" />,
      },
    ],
  },
  {
    key: 'portal-financeiro',
    label: 'Financeiro',
    icon: <BanknotesIcon className="h-5 w-5" />,
    iconSolid: <BanknotesSolid className="h-5 w-5" />,
    items: [
      {
        label: 'Cobranças',
        href: '/portal/finance',
        icon: <BanknotesIcon className="h-5 w-5" />,
        iconSolid: <BanknotesSolid className="h-5 w-5" />,
      },
    ],
  },
  {
    key: 'portal-eventos',
    label: 'Eventos',
    icon: <TicketIcon className="h-5 w-5" />,
    iconSolid: <TicketSolid className="h-5 w-5" />,
    items: [
      {
        label: 'Meus Eventos',
        href: '/portal/events',
        icon: <TicketIcon className="h-5 w-5" />,
        iconSolid: <TicketSolid className="h-5 w-5" />,
      },
    ],
  },
];

export const SIDEBAR_PERMISSIONS: Record<SidebarRoleKey, SidebarPermissionSet> = {
  ADMIN: {
    allowDashboard: true,
    allowGroups: SIDEBAR_GROUPS.map((g) => ({ key: g.key })),
    allowSettings: true,
    allowPortal: true,
  },
  FINANCEIRO: {
    allowDashboard: true,
    allowGroups: [
      { key: 'cobrancas' },
      { key: 'meu-dinheiro' },
      { key: 'antecipacoes' },
      { key: 'financeiro' },
      { key: 'eventos', items: ['/events', '/events/tickets', '/events/financial', '/events/reports'] },
      { key: 'relatorios' },
    ],
    allowPortal: false,
    allowSettings: false,
  },
  RECEPCAO: {
    allowDashboard: true,
    allowGroups: [
      { key: 'cadastro', items: ['/students', '/responsibles', '/employees'] },
      { key: 'matriculas' },
      { key: 'aulas' },
      { key: 'vendas' },
      { key: 'eventos' },
    ],
    allowPortal: false,
    allowSettings: false,
  },
  PROFESSOR: {
    allowDashboard: true,
    allowGroups: [{ key: 'aulas' }, { key: 'eventos', items: ['/events', '/events/costumes'] }, { key: 'relatorios' }],
    allowPortal: false,
    allowSettings: false,
  },
  RESPONSAVEL: {
    allowDashboard: true,
    allowGroups: SIDEBAR_PORTAL_GROUPS.map((g) => ({ key: g.key })),
    allowPortal: true,
    allowSettings: false,
  },
  ALUNO: {
    allowDashboard: true,
    allowGroups: SIDEBAR_PORTAL_GROUPS.map((g) => ({ key: g.key })),
    allowPortal: true,
    allowSettings: false,
  },
};

type FinancialCaps = ReturnType<typeof resolveFinancialCapabilities>;

export function computeAllowedSidebarGroups(
  sourceGroups: SidebarGroup[],
  perm: SidebarPermissionSet,
  financialCapabilities: FinancialCaps,
  showAutomaticAnticipationItem: boolean,
): SidebarGroup[] {
  return sourceGroups
    .filter((g) => {
      if (
        g.key === 'meu-dinheiro' &&
        (!financialCapabilities.canUseAccountBalance || !financialCapabilities.canUseStatement)
      ) {
        return false;
      }

      if (g.key === 'antecipacoes' && !financialCapabilities.canUseAnticipations) {
        return false;
      }

      if (perm.allowGroups.some((p) => p.key === g.key && (!p.items || p.items.length === 0)))
        return true;
      return perm.allowGroups.some((p) => p.key === g.key);
    })
    .map((g) => {
      const entry = perm.allowGroups.find((p) => p.key === g.key);
      const scopedItems =
        g.key === 'antecipacoes' && !showAutomaticAnticipationItem
          ? g.items.filter((item) => item.href !== AUTOMATIC_ANTICIPATION_ITEM_HREF)
          : g.items;

      if (!entry || !entry.items || entry.items.length === 0) {
        return {
          ...g,
          items: scopedItems,
        } as SidebarGroup;
      }

      return {
        ...g,
        items: scopedItems.filter((i) => entry.items!.includes(i.href)),
      } as SidebarGroup;
    });
}

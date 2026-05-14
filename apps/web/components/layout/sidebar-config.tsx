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
  WalletIcon,
  WalletSolid,
  DocumentText,
  DocumentDuplicate,
  DocumentTextSolid,
  DocumentDuplicateSolid,
} from '@/components/icons/icons';
import { resolveFinancialCapabilities } from '@/lib/finance/financial-capabilities';

export const FINANCE_LOCKED_GROUP_KEYS = new Set(['financeiro', 'meu-dinheiro', 'antecipacoes']);
export const AUTOMATIC_ANTICIPATION_ITEM_HREF = '/antecipacoes/automatica';

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
        href: '/alunos',
        icon: <UserIcon className="h-5 w-5" />,
        iconSolid: <UserSolid className="h-5 w-5" />,
      },
      {
        label: 'Responsáveis',
        href: '/responsaveis',
        icon: <UsersIcon className="h-5 w-5" />,
        iconSolid: <UsersSolid className="h-5 w-5" />,
      },
      {
        label: 'Colaboradores',
        href: '/colaboradores',
        icon: <UsersIcon className="h-5 w-5" />,
        iconSolid: <UsersSolid className="h-5 w-5" />,
      },
      {
        label: 'Turmas',
        href: '/turmas',
        icon: <BookOpenIcon className="h-5 w-5" />,
        iconSolid: <BookOpenSolid className="h-5 w-5" />,
      },
      {
        label: 'Planos',
        href: '/planos',
        icon: <RectangleStackIcon className="h-5 w-5" />,
        iconSolid: <RectangleStackSolid className="h-5 w-5" />,
      },
      {
        label: 'Combos',
        href: '/combos',
        icon: <RectangleStackIcon className="h-5 w-5" />,
        iconSolid: <RectangleStackSolid className="h-5 w-5" />,
      },
      {
        label: 'Modalidades',
        href: '/modalidades',
        icon: <BookOpenIcon className="h-5 w-5" />,
        iconSolid: <BookOpenSolid className="h-5 w-5" />,
      },
      {
        label: 'Salas',
        href: '/salas',
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
        href: '/matriculas',
        icon: <ClipboardDocumentCheckIcon className="h-5 w-5" />,
        iconSolid: <ClipboardDocumentCheckSolid className="h-5 w-5" />,
      },
      {
        label: 'Rematrículas',
        href: '/rematriculas',
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
        href: '/contratos',
        icon: <DocumentText className="h-5 w-5" />,
        iconSolid: <DocumentTextSolid className="h-5 w-5" />,
      },
      {
        label: 'Modelos',
        href: '/contratos/modelos',
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
        href: '/cobrancas',
        icon: <BanknotesIcon className="h-5 w-5" />,
        iconSolid: <BanknotesSolid className="h-5 w-5" />,
      },
      {
        label: 'Avulsas',
        href: '/cobrancas/avulsas',
        icon: <BanknotesIcon className="h-5 w-5" />,
        iconSolid: <BanknotesSolid className="h-5 w-5" />,
      },
      {
        label: 'Parcelamentos',
        href: '/cobrancas/parcelamentos',
        icon: <RectangleStackIcon className="h-5 w-5" />,
        iconSolid: <RectangleStackSolid className="h-5 w-5" />,
      },
      {
        label: 'Assinaturas',
        href: '/cobrancas/assinaturas',
        icon: <ClipboardDocumentCheckIcon className="h-5 w-5" />,
        iconSolid: <ClipboardDocumentCheckSolid className="h-5 w-5" />,
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
        href: '/financeiro/conta',
        icon: <WalletIcon className="h-5 w-5" />,
        iconSolid: <WalletSolid className="h-5 w-5" />,
      },
      {
        label: 'Extrato',
        href: '/financeiro/extrato',
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
        href: '/antecipacoes/minhas',
        icon: <DocumentText className="h-5 w-5" />,
        iconSolid: <DocumentTextSolid className="h-5 w-5" />,
      },
      {
        label: 'Antecipar recebimento',
        href: '/antecipacoes/antecipar',
        icon: <BanknotesIcon className="h-5 w-5" />,
        iconSolid: <BanknotesSolid className="h-5 w-5" />,
      },
      {
        label: 'Antecipação automática',
        href: '/antecipacoes/automatica',
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
        href: '/financeiro/pagamentos',
        icon: <BanknotesIcon className="h-5 w-5" />,
        iconSolid: <BanknotesSolid className="h-5 w-5" />,
      },
      {
        label: 'Relatórios',
        href: '/financeiro/relatorios',
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
        href: '/aulas/agenda',
        icon: <BookOpenIcon className="h-5 w-5" />,
        iconSolid: <BookOpenSolid className="h-5 w-5" />,
      },
      {
        label: 'Frequência',
        href: '/aulas/frequencia',
        icon: <CalendarDaysIcon className="h-5 w-5" />,
        iconSolid: <CalendarDaysSolid className="h-5 w-5" />,
      },
      {
        label: 'Reposições de aula',
        href: '/aulas/reposicoes',
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
        href: '/vendas/nova',
        icon: <ShoppingCartIcon className="h-5 w-5" />,
        iconSolid: <ShoppingCartSolid className="h-5 w-5" />,
      },
      {
        label: 'Histórico',
        href: '/vendas/historico',
        icon: <ClockIcon className="h-5 w-5" />,
        iconSolid: <ClockSolid className="h-5 w-5" />,
      },
      {
        label: 'Produtos',
        href: '/vendas/produtos',
        icon: <CubeIcon className="h-5 w-5" />,
        iconSolid: <CubeSolid className="h-5 w-5" />,
      },
      {
        label: 'Estoque',
        href: '/vendas/estoque',
        icon: <CircleStackIcon className="h-5 w-5" />,
        iconSolid: <CircleStackSolid className="h-5 w-5" />,
      },
      {
        label: 'Reposições de estoque',
        href: '/vendas/reposicoes',
        icon: <ArrowPathRoundedSquareIcon className="h-5 w-5" />,
        iconSolid: <ArrowPathRoundedSquareSolid className="h-5 w-5" />,
      },
      {
        label: 'Categorias',
        href: '/vendas/categorias',
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
    comingSoon: true,
    items: [
      {
        label: 'Lista',
        href: '/eventos',
        icon: <TicketIcon className="h-5 w-5" />,
        iconSolid: <TicketSolid className="h-5 w-5" />,
      },
      {
        label: 'Criar',
        href: '/eventos/novo',
        icon: <TicketIcon className="h-5 w-5" />,
        iconSolid: <TicketSolid className="h-5 w-5" />,
      },
      {
        label: 'Ingressos',
        href: '/eventos/ingressos',
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
        href: '/portal/matriculas',
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
        href: '/portal/financeiro',
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
        href: '/portal/eventos',
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
      { key: 'relatorios' },
    ],
    allowPortal: false,
    allowSettings: false,
  },
  RECEPCAO: {
    allowDashboard: true,
    allowGroups: [
      { key: 'cadastro', items: ['/alunos', '/responsaveis', '/colaboradores'] },
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
    allowGroups: [{ key: 'aulas' }, { key: 'relatorios' }],
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

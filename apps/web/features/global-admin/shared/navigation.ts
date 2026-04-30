import type { ComponentType, SVGProps } from 'react';

import {
  AlertCircle,
  ClipboardDocumentCheck,
  CreditCard,
  Dashboard,
  DocumentText,
  Search,
  StoreFront,
  Users,
  Warning,
  Wrench,
} from '@/components/icons/icons';

export type GlobalAdminNavigationItem = {
  href: string;
  label: string;
  shortLabel: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  description: string;
};

export const globalAdminNavigation: GlobalAdminNavigationItem[] = [
  {
    href: '/developer/dashboard',
    label: 'Visão Geral',
    shortLabel: 'Visão Geral',
    icon: Dashboard,
    description: 'Resumo da operação, do suporte e da saúde da Alusa.',
  },
  {
    href: '/developer/users',
    label: 'Usuários',
    shortLabel: 'Usuários',
    icon: Users,
    description: 'Lista completa para localizar e atender usuários.',
  },
  {
    href: '/developer/tenants',
    label: 'Contas',
    shortLabel: 'Contas',
    icon: StoreFront,
    description: 'Visão por conta para atender cobrança, webhook e operação.',
  },
  {
    href: '/developer/problems',
    label: 'Problemas',
    shortLabel: 'Problemas',
    icon: Warning,
    description: 'Casos do dia a dia que pedem ação rápida.',
  },
  {
    href: '/developer/search',
    label: 'Busca',
    shortLabel: 'Busca',
    icon: Search,
    description: 'Busca por conta, usuário, cobrança, matrícula ou webhook.',
  },
  {
    href: '/developer/requests',
    label: 'Requisições',
    shortLabel: 'Requisições',
    icon: DocumentText,
    description: 'Histórico das integrações e chamadas importantes.',
  },
  {
    href: '/developer/webhooks',
    label: 'Webhooks',
    shortLabel: 'Webhooks',
    icon: CreditCard,
    description: 'Eventos do Asaas e status de processamento.',
  },
  {
    href: '/developer/errors',
    label: 'Erros',
    shortLabel: 'Erros',
    icon: AlertCircle,
    description: 'Falhas que impactam atendimento e operação.',
  },
  {
    href: '/developer/actions',
    label: 'Ações Rápidas',
    shortLabel: 'Ações',
    icon: Wrench,
    description: 'Ferramentas para corrigir fluxos e sincronizações.',
  },
  {
    href: '/developer/audit',
    label: 'Histórico',
    shortLabel: 'Histórico',
    icon: ClipboardDocumentCheck,
    description: 'Tudo que foi feito no suporte e no admin global.',
  },
];

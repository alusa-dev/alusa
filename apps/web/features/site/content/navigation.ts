import type { FooterGroupDto, SiteNavItem } from '@/features/site/lib/site-dtos';
import { appLoginUrl } from '@/features/site/lib/urls';

export { appLoginUrl, appUrl } from '@/features/site/lib/urls';

export const primaryNavigation = [
  { label: 'Produto', sectionId: 'modulos' },
  { label: 'Financeiro', sectionId: 'financeiro' },
  { label: 'Demonstração', href: 'mailto:contato@alusa.app' },
  { label: 'Contato', sectionId: 'contato' },
] as const satisfies readonly SiteNavItem[];

export const footerGroups = [
  {
    title: 'Plataforma',
    links: [
      { label: 'Funcionalidades', sectionId: 'modulos' },
      { label: 'Financeiro', sectionId: 'financeiro' },
      { label: 'Portal', sectionId: 'modulos' },
      { label: 'Gestão', sectionId: 'modulos' },
    ],
  },
  {
    title: 'Empresa',
    links: [
      { label: 'Sobre', sectionId: 'contato' },
      { label: 'Contato', sectionId: 'contato' },
      { label: 'Demonstração', href: 'mailto:contato@alusa.app' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacidade', sectionId: 'contato' },
      { label: 'Termos', sectionId: 'contato' },
    ],
  },
  {
    title: 'Acesso',
    links: [
      { label: 'Login', href: appLoginUrl },
      { label: 'Criar conta', href: 'mailto:contato@alusa.app' },
    ],
  },
] as const satisfies readonly FooterGroupDto[];

import type { FooterGroupDto, SiteNavItem } from '@/features/site/lib/site-dtos';
import { appLoginUrl } from '@/features/site/lib/urls';

export { appLoginUrl, appUrl } from '@/features/site/lib/urls';

export const primaryNavigation = [
  { label: 'Produto', sectionId: 'modulos' },
  { label: 'Solução', sectionId: 'financeiro' },
  { label: 'Dúvidas', sectionId: 'contato' },
  { label: 'Fale conosco', href: 'mailto:gestao.alusa@gmail.com' },
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
      { label: 'Demonstração', href: 'mailto:gestao.alusa@gmail.com' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Central legal', href: '/legal' },
      { label: 'Privacidade', href: '/privacidade' },
      { label: 'Termos', href: '/termos' },
      { label: 'Cookies', href: '/cookies' },
      { label: 'Segurança', href: '/security' },
      { label: 'Suboperadores', href: '/suboperadores' },
      { label: 'DPA', href: '/dpa' },
      { label: 'Direitos LGPD', href: '/direitos-lgpd' },
    ],
  },
  {
    title: 'Acesso',
    links: [
      { label: 'Login', href: appLoginUrl },
      { label: 'Entre na lista de espera', href: '/lista-de-espera' },
    ],
  },
] as const satisfies readonly FooterGroupDto[];

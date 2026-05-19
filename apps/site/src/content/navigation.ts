import type { FooterGroupDto, RouteDto } from '@/lib/site-dtos';

export const primaryNavigation = [
  { label: 'Produto', href: '#modulos' },
  { label: 'Financeiro', href: '#financeiro' },
  { label: 'Segurança', href: '#seguranca' },
  { label: 'Demonstração', href: 'mailto:contato@alusa.app' },
  { label: 'Contato', href: '#contato' }
] as const satisfies readonly RouteDto[];

export const footerGroups = [
  {
    title: 'Plataforma',
    links: [
      { label: 'Funcionalidades', href: '#modulos' },
      { label: 'Financeiro', href: '#financeiro' },
      { label: 'Portal', href: '#modulos' },
      { label: 'Gestão', href: '#modulos' }
    ]
  },
  {
    title: 'Empresa',
    links: [
      { label: 'Sobre', href: '#contato' },
      { label: 'Contato', href: '#contato' },
      { label: 'Demonstração', href: 'mailto:contato@alusa.app' }
    ]
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacidade', href: '#contato' },
      { label: 'Termos', href: '#contato' },
      { label: 'Segurança', href: '#seguranca' }
    ]
  },
  {
    title: 'Acesso',
    links: [
      { label: 'Login', href: 'https://www.alusa.app/auth/login' },
      { label: 'Criar conta', href: 'mailto:contato@alusa.app' }
    ]
  }
] as const satisfies readonly FooterGroupDto[];

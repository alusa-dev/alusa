import type { Metadata } from 'next';

import { siteUrl } from '@/features/site/lib/urls';

export const siteMetadata = {
  name: 'Alusa',
  title: 'Alusa | Infraestrutura financeira e operacional para negocios recorrentes',
  description:
    'A Alusa conecta cobrancas, contratos, agenda, atendimento e indicadores em uma plataforma para operacoes recorrentes com controle e previsibilidade.',
  url: siteUrl
} as const;

export function buildMetadata(): Metadata {
  return {
    metadataBase: new URL(siteMetadata.url),
    title: {
      default: siteMetadata.title,
      template: `%s | ${siteMetadata.name}`
    },
    description: siteMetadata.description,
    applicationName: siteMetadata.name,
    icons: {
      icon: '/favicon.svg',
      shortcut: '/favicon.svg',
      apple: '/favicon.svg'
    },
    alternates: {
      canonical: '/'
    },
    openGraph: {
      title: siteMetadata.title,
      description: siteMetadata.description,
      url: siteMetadata.url,
      siteName: siteMetadata.name,
      locale: 'pt_BR',
      type: 'website'
    },
    twitter: {
      card: 'summary_large_image',
      title: siteMetadata.title,
      description: siteMetadata.description
    },
    robots: {
      index: true,
      follow: true
    }
  };
}

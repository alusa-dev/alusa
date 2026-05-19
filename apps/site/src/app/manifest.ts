import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Alusa',
    short_name: 'Alusa',
    description: 'Infraestrutura financeira e operacional para negocios recorrentes.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#050816',
    icons: [
      {
        src: '/favicon.svg',
        sizes: 'any',
        type: 'image/svg+xml'
      }
    ]
  };
}

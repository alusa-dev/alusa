import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: { default: 'Alusa Admin', template: '%s | Alusa Admin' },
  description: 'Backoffice operacional da plataforma Alusa.',
  icons: { icon: '/brand/symbol.svg' },
};

export default function AdminRootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}

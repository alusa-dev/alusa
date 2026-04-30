import { redirect } from 'next/navigation';

export default function ConfiguracoesPoliticasFinanceiroPage() {
  redirect('/admin/configuracoes/politicas');
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

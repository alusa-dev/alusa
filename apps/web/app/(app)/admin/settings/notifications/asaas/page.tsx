import { redirect } from 'next/navigation';

export default async function ConfiguracoesNotificacoesAsaasPage() {
  redirect('/admin/configuracoes/notificacoes');
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

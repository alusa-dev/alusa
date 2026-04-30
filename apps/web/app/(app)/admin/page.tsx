import { redirect } from 'next/navigation';

export default function AdminIndexPage() {
  // Redireciona para o módulo Configurações
  redirect('/admin/configuracoes');
}

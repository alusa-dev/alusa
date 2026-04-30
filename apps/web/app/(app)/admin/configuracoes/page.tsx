import { redirect } from 'next/navigation';

export default function ConfiguracoesIndexPage() {
  // Redireciona para a primeira aba padrão
  redirect('/admin/configuracoes/usuarios');
}

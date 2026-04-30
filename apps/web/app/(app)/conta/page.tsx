import { redirect } from 'next/navigation';

export default function MinhaContaIndexPage() {
  // Redireciona para a primeira seção padrão
  redirect('/conta/perfil');
}

import { redirect } from 'next/navigation';

export default function NovoEventoRedirectPage() {
  redirect('/events/new');
}

'use client';
// Hook: abstrai acesso ao usuário atual com tipagem forte e flags de estado.
import { useSession } from 'next-auth/react';

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: string;
  contaId: string | null; // null quando ainda não carregado ou inexistente
}

export function useCurrentUser() {
  const { data, status } = useSession();
  const raw = (data?.user as CurrentUser | undefined) ?? undefined;
  // Converter contaId === '' para null para evitar falsos negativos de tenant
  const user = raw ? { ...raw, contaId: raw.contaId === '' ? null : raw.contaId } : undefined;
  return {
    user,
    loading: status === 'loading',
    authenticated: status === 'authenticated',
    unauthenticated: status === 'unauthenticated',
  };
}

export default useCurrentUser;

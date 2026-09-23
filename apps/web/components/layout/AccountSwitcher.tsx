'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

type Account = { id: string; name: string; role: string };

export function AccountSwitcher() {
  const { data: session, update: updateSession } = useSession();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/users/accounts', { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!cancelled && Array.isArray(payload?.accounts)) setAccounts(payload.accounts);
      })
      .catch(() => { if (!cancelled) setAccounts([]); });
    return () => { cancelled = true; };
  }, []);

  async function switchAccount(contaId: string) {
    if (contaId === session?.user?.contaId || switching) return;
    setSwitching(true);
    setError(null);
    try {
      await updateSession({ contaId });
      window.location.assign('/dashboard');
    } catch {
      setError('Não foi possível trocar de escola. Tente novamente.');
      setSwitching(false);
    }
  }

  if (accounts.length < 2) return null;

  return (
    <section className="border-b border-black/5 p-3 alusa-dark:border-white/10" aria-label="Trocar escola">
      <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Escola ativa</p>
      <div className="space-y-1">
        {accounts.map((account) => (
          <button key={account.id} type="button" disabled={switching}
            aria-current={account.id === session?.user?.contaId ? 'true' : undefined}
            onClick={() => void switchAccount(account.id)}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-black/5 disabled:opacity-60 ${account.id === session?.user?.contaId ? 'font-semibold text-[#61318f]' : ''}`}>
            <span className="truncate">{account.name}</span>
            <span className="ml-2 shrink-0 text-xs text-gray-500">{account.role}</span>
          </button>
        ))}
      </div>
      {error ? <p role="alert" className="mt-2 text-xs text-red-600">{error}</p> : null}
    </section>
  );
}

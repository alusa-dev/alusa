'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface AccountsSearchProps {
  initialQuery: string;
}

export function AccountsSearch({ initialQuery }: AccountsSearchProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(initialQuery);

  const updateSearch = useCallback(
    (nextValue: string) => {
      const query = nextValue.trim().replace(/\s+/g, ' ');
      const params = new URLSearchParams(window.location.search);

      if (query) {
        params.set('q', query);
      } else {
        params.delete('q');
      }
      params.delete('page');

      const nextSearch = params.toString();
      const currentSearch = window.location.search.replace(/^\?/, '');
      if (nextSearch === currentSearch) return;

      router.replace(`${pathname}${nextSearch ? `?${nextSearch}` : ''}`, { scroll: false });
    },
    [pathname, router],
  );

  useEffect(() => {
    setValue(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => updateSearch(value), 350);
    return () => window.clearTimeout(timeoutId);
  }, [updateSearch, value]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateSearch(value);
  }

  return (
    <form className="overview-search-form accounts-search-form" action="/contas" onSubmit={handleSubmit} role="search">
      <div className="overview-search-field">
        <Input
          name="q"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="overview-search-input"
          placeholder="Nome, CPF ou CNPJ"
          aria-label="Buscar contas"
          autoComplete="off"
        />
      </div>
      <Button className="overview-search-button" type="submit">Buscar</Button>
    </form>
  );
}

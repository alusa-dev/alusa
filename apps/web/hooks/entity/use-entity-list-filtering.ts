import { useEffect, useMemo, useState } from 'react';

export type StatusValue = 'TODOS' | 'ATIVO' | 'INATIVO';
export type SortOrder = 'ASC' | 'DESC';

export interface UseEntityListFilteringParams<T> {
  items: T[];
  statusAccessor?: (_item: T) => StatusValue | string | null | undefined;
  nameAccessor?: (_item: T) => string | null | undefined; // usado para ordenação padrão
  searchPredicate?: (_item: T, _search: string, _digits: string) => boolean; // se não passar, usa nameAccessor
  statusFilterEnabled?: boolean; // default true
  initialSort?: SortOrder;
}

export interface UseEntityListFilteringResult<T> {
  search: string;
  setSearch: (_v: string) => void;
  status: StatusValue;
  setStatus: (_v: StatusValue) => void;
  sort: SortOrder;
  setSort: (_v: SortOrder) => void;
  page: number;
  setPage: (_p: number) => void;
  pageSize: number;
  setPageSize: (_s: number) => void;
  filtered: T[];
  ordered: T[];
  paginated: T[];
  total: number;
  totalPages: number;
  resetFilters: () => void;
}

const DEFAULT_PAGE_SIZE = 6;

export function useEntityListFiltering<T>(
  params: UseEntityListFilteringParams<T>,
): UseEntityListFilteringResult<T> {
  const {
    items,
    statusAccessor,
    nameAccessor,
    searchPredicate,
    statusFilterEnabled = true,
    initialSort = 'ASC',
  } = params;

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusValue>('TODOS');
  const [sort, setSort] = useState<SortOrder>(initialSort);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // quando filtros mudam, volta para a página 1
  useEffect(() => {
    setPage(1);
  }, [search, status]);

  // reset page when pageSize changes
  useEffect(() => {
    setPage(1);
  }, [pageSize]);

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    const digits = search.replace(/\D/g, '');
    return items.filter((item) => {
      if (statusFilterEnabled && status !== 'TODOS') {
        const st = statusAccessor?.(item) ?? null;
        if (st && st !== status) return false;
      }
      if (!term && !digits) return true;
      if (searchPredicate) return searchPredicate(item, term, digits);
      const name = (nameAccessor?.(item) || '').toLowerCase();
      return name.includes(term) || (digits && name.replace(/\D/g, '').includes(digits));
    });
  }, [items, search, status, statusAccessor, searchPredicate, nameAccessor, statusFilterEnabled]);

  const ordered = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (!nameAccessor) return 0;
      const aName = (nameAccessor(a) || '').toLowerCase();
      const bName = (nameAccessor(b) || '').toLowerCase();
      const comp = aName.localeCompare(bName, 'pt-BR', { sensitivity: 'base' });
      return sort === 'ASC' ? comp : -comp;
    });
  }, [filtered, sort, nameAccessor]);

  const total = ordered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return ordered.slice(start, start + pageSize);
  }, [ordered, page, pageSize]);

  function resetFilters() {
    setSearch('');
    setStatus('TODOS');
    setSort('ASC');
    setPage(1);
  }

  return {
    search,
    setSearch,
    status,
    setStatus,
    sort,
    setSort,
    page,
    setPage,
    pageSize,
    setPageSize,
    filtered,
    ordered,
    paginated,
    total,
    totalPages,
    resetFilters,
  };
}

export default useEntityListFiltering;

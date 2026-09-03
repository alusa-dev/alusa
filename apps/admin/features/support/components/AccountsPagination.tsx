import Link from 'next/link';

interface AccountsPaginationProps {
  query: string;
  page: number;
  totalPages: number;
}

function pageHref(query: string, page: number) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (page > 1) params.set('page', String(page));
  const search = params.toString();
  return `/contas${search ? `?${search}` : ''}`;
}

export function AccountsPagination({ query, page, totalPages }: AccountsPaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <nav className="accounts-pagination" aria-label="Paginação de contas">
      <span className="accounts-pagination-summary">Página {page} de {totalPages}</span>
      <div className="accounts-pagination-actions">
        {page > 1 ? (
          <Link className="accounts-pagination-text" href={pageHref(query, page - 1)}>Anterior</Link>
        ) : (
          <span className="accounts-pagination-text is-disabled" aria-disabled="true">Anterior</span>
        )}
        {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => (
          <Link
            key={pageNumber}
            className={`accounts-pagination-page${pageNumber === page ? ' is-active' : ''}`}
            href={pageHref(query, pageNumber)}
            aria-current={pageNumber === page ? 'page' : undefined}
          >
            {pageNumber}
          </Link>
        ))}
        {page < totalPages ? (
          <Link className="accounts-pagination-text" href={pageHref(query, page + 1)}>Próxima</Link>
        ) : (
          <span className="accounts-pagination-text is-disabled" aria-disabled="true">Próxima</span>
        )}
      </div>
    </nav>
  );
}

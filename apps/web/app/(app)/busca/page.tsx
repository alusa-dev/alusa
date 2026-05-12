import { GlobalSearchResultsPage } from '@/features/global-search/components/GlobalSearchResultsPage';

type BuscaPageProps = {
  searchParams?: {
    q?: string;
  };
};

export default function BuscaPage({ searchParams }: BuscaPageProps) {
  const initialQuery = typeof searchParams?.q === 'string' ? searchParams.q : '';

  return <GlobalSearchResultsPage initialQuery={initialQuery} />;
}
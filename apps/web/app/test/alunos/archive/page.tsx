import { notFound } from 'next/navigation';
import TestAlunoArchiveClient from './test-aluno-archive-client';

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ searchParams }: PageProps) {
  if (process.env.NODE_ENV === 'production' || process.env.TEST_ROUTES_ENABLED !== 'true') {
    notFound();
  }

  const resolvedSearchParams = await searchParams;
  const alunoIdParam = resolvedSearchParams?.alunoId;
  const alunoId = Array.isArray(alunoIdParam) ? alunoIdParam[0] : alunoIdParam ?? '';

  return <TestAlunoArchiveClient alunoId={alunoId} />;
}

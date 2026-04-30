import { notFound } from 'next/navigation';
import TestAlunoArchiveClient from './test-aluno-archive-client';

type PageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default function Page({ searchParams }: PageProps) {
  if (process.env.TEST_ROUTES_ENABLED !== 'true') {
    notFound();
  }

  const alunoIdParam = searchParams?.alunoId;
  const alunoId = Array.isArray(alunoIdParam) ? alunoIdParam[0] : alunoIdParam ?? '';

  return <TestAlunoArchiveClient alunoId={alunoId} />;
}

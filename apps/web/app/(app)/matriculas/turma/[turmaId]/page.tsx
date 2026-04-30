'use client';

import MatriculasFeature from '@/features/cadastro/matriculas/MatriculasFeature';

interface PageProps {
  params: {
    turmaId: string;
  };
}

export default function TurmaMatriculasPage({ params }: PageProps) {
  return (
    <div className="px-6 pt-6 pb-8 md:px-8 md:pt-8 md:pb-12">
      <MatriculasFeature initialTurmaId={params.turmaId} />
    </div>
  );
}

import MatriculasFeature from '@/features/cadastro/matriculas/MatriculasFeature';

export default async function TurmaMatriculasPage({
  params,
}: {
  params: Promise<{ turmaId: string }>;
}) {
  const { turmaId } = await params;
  return (
    <div className="px-6 pt-6 pb-8 md:px-8 md:pt-8 md:pb-12">
      <MatriculasFeature initialTurmaId={turmaId} />
    </div>
  );
}

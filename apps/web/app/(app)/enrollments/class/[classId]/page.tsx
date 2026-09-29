import MatriculasFeature from '@/features/enrollments/EnrollmentsFeature';

export default async function TurmaMatriculasPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  return (
    <div className="px-6 pt-6 pb-8 md:px-8 md:pt-8 md:pb-12">
      <MatriculasFeature initialTurmaId={classId} />
    </div>
  );
}

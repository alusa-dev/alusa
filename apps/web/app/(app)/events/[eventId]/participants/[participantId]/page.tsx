import { ParticipantDetailsFeature } from '@/features/events/participants/ParticipantDetailsFeature';

export default async function ParticipantDetailsPage({
  params,
}: {
  params: Promise<{ eventId: string; participantId: string }>;
}) {
  const resolvedParams = await params;
  return (
    <ParticipantDetailsFeature
      eventId={resolvedParams.eventId}
      participantId={resolvedParams.participantId}
    />
  );
}

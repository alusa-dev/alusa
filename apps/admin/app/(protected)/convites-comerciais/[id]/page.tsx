import { redirect } from 'next/navigation';

export default async function LegacyCommercialInvitationDetailRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/convites/${encodeURIComponent(id)}`);
}

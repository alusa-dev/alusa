import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getWhatsAppRuntimeStatus } from '@/src/server/whatsapp/config';
import WhatsAppTestFeature from '@/features/comunicacao/WhatsAppTestFeature';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function WhatsAppTestPage() {
  const user = await getSessionUser();
  if (!user) redirect('/auth/login?callbackUrl=/comunicacao/whatsapp-teste');

  return <WhatsAppTestFeature status={getWhatsAppRuntimeStatus()} />;
}

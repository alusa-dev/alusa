import { permanentRedirect } from 'next/navigation';

export default function LegacyExpertContactPage() {
  permanentRedirect('/get-started');
}

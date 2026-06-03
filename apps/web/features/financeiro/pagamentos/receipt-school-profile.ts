import { fetchCurrentProfile } from '@/features/account/services/profile-service';
import type { PaidReceiptEscola } from './paid-receipts-pdf';

export async function loadPaidReceiptSchoolProfile(): Promise<PaidReceiptEscola | null> {
  const [profile, financeRes] = await Promise.all([
    fetchCurrentProfile(),
    fetch('/api/conta/finance-onboarding', { cache: 'no-store' }).catch(() => null),
  ]);
  const school = profile.school;

  if (!school) return null;

  let telefone = profile.telefone ?? null;
  let email = profile.email ?? null;

  if (financeRes?.ok) {
    const finance = await financeRes.json().catch(() => null);
    const commercialInfo = finance?.financialAccount?.commercialInfo;
    telefone =
      commercialInfo?.mobilePhone ??
      commercialInfo?.phone ??
      finance?.financeProfile?.mobilePhone ??
      finance?.financeProfile?.asaasPhone ??
      telefone;
    email =
      commercialInfo?.email ??
      finance?.financeProfile?.asaasLoginEmail ??
      email;
  }

  return {
    nome: school.name,
    cpfCnpj: school.cpfCnpj ?? null,
    telefone,
    email,
  };
}

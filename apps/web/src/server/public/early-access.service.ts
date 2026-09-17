import { prisma } from '@/lib/prisma';

export type EarlyAccessLeadInput = {
  institutionName: string;
  contactName: string;
  role: string;
  email: string;
  phone: string;
  studentsRange: string;
  mainChallenge?: string;
  marketingConsent: true;
};

export async function upsertEarlyAccessLead(input: {
  lead: EarlyAccessLeadInput;
  marketingConsentIp: string | null;
  marketingConsentUserAgent: string | null;
}) {
  const { lead, marketingConsentIp, marketingConsentUserAgent } = input;
  return prisma.earlyAccessLead.upsert({
    where: { email: lead.email },
    create: {
      institutionName: lead.institutionName,
      contactName: lead.contactName,
      role: lead.role,
      email: lead.email,
      phone: lead.phone,
      studentsRange: lead.studentsRange,
      mainChallenge: lead.mainChallenge,
      marketingConsent: lead.marketingConsent,
      marketingConsentAt: new Date(),
      marketingConsentIp,
      marketingConsentUserAgent,
    },
    update: {
      institutionName: lead.institutionName,
      contactName: lead.contactName,
      role: lead.role,
      phone: lead.phone,
      studentsRange: lead.studentsRange,
      mainChallenge: lead.mainChallenge,
      marketingConsent: lead.marketingConsent,
      marketingConsentAt: new Date(),
      marketingConsentIp,
      marketingConsentUserAgent,
    },
  });
}

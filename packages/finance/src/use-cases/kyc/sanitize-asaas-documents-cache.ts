import type { AsaasMyAccountDocumentsResponse } from '@alusa/asaas';

export function sanitizeAsaasDocumentsForCache(
  documents: AsaasMyAccountDocumentsResponse,
): AsaasMyAccountDocumentsResponse {
  return {
    ...documents,
    data: documents.data.map((group) => {
      const {
        onboardingUrl: _onboardingUrl,
        onboardingUrlExpirationDate: _onboardingUrlExpirationDate,
        ...rest
      } = group as unknown as {
        onboardingUrl?: unknown;
        onboardingUrlExpirationDate?: unknown;
      };

      return rest as typeof group;
    }),
  };
}

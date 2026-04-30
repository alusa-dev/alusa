export class OnboardingUrlRequiredError extends Error {
  readonly code = 'ONBOARDING_URL_REQUIRED';
  readonly onboardingUrl: string;

  constructor(params: { onboardingUrl: string }) {
    super('Este envio deve ser feito pelo link externo de verificação.');
    this.name = 'OnboardingUrlRequiredError';
    this.onboardingUrl = params.onboardingUrl;
  }
}

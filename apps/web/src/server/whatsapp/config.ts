import { WhatsAppConfigurationError, normalizeWhatsAppPhone } from '@alusa/whatsapp';

export type WhatsAppRuntimeConfig = {
  enabled: boolean;
  testMode: boolean;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
  phoneNumberId: string;
  wabaId: string;
  graphApiVersion: string;
  testTemplateName: string;
  testTemplateLanguage: string;
  testAllowlist: string[];
};

export function getWhatsAppRuntimeConfig(): WhatsAppRuntimeConfig {
  const testAllowlist = (process.env.WHATSAPP_TEST_ALLOWLIST ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => normalizeWhatsAppPhone(value));

  return {
    enabled: process.env.WHATSAPP_ENABLED === 'true',
    testMode: process.env.WHATSAPP_TEST_MODE === 'true',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN?.trim() ?? '',
    appSecret: process.env.WHATSAPP_APP_SECRET?.trim() ?? '',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN?.trim() ?? '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? '',
    wabaId: process.env.WHATSAPP_WABA_ID?.trim() ?? '',
    graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION?.trim() || 'v25.0',
    testTemplateName: process.env.WHATSAPP_TEST_TEMPLATE_NAME?.trim() || 'hello_world',
    testTemplateLanguage: process.env.WHATSAPP_TEST_TEMPLATE_LANGUAGE?.trim() || 'en_US',
    testAllowlist,
  };
}

export function assertWhatsAppConfigured(config = getWhatsAppRuntimeConfig()): WhatsAppRuntimeConfig {
  const missing = [
    ['WHATSAPP_ACCESS_TOKEN', config.accessToken],
    ['WHATSAPP_APP_SECRET', config.appSecret],
    ['WHATSAPP_VERIFY_TOKEN', config.verifyToken],
    ['WHATSAPP_PHONE_NUMBER_ID', config.phoneNumberId],
    ['WHATSAPP_WABA_ID', config.wabaId],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length) {
    throw new WhatsAppConfigurationError(`Configuração WhatsApp incompleta: ${missing.join(', ')}.`);
  }

  if (!config.enabled) {
    throw new WhatsAppConfigurationError('A integração WhatsApp está desabilitada (WHATSAPP_ENABLED).');
  }

  return config;
}

export function getWhatsAppRuntimeStatus() {
  const config = getWhatsAppRuntimeConfig();
  return {
    enabled: config.enabled,
    testMode: config.testMode,
    configured: Boolean(
      config.accessToken &&
        config.appSecret &&
        config.verifyToken &&
        config.phoneNumberId &&
        config.wabaId,
    ),
    phoneNumberId: config.phoneNumberId || null,
    testAllowlistCount: config.testAllowlist.length,
  };
}

export function assertTestRecipient(to: string, config = getWhatsAppRuntimeConfig()): string {
  const normalized = normalizeWhatsAppPhone(to);
  if (!config.testMode) {
    throw new WhatsAppConfigurationError('O modo de teste WhatsApp está desabilitado.');
  }
  if (!config.testAllowlist.includes(normalized)) {
    throw new WhatsAppConfigurationError('O destinatário não está na lista de testes WhatsApp.');
  }
  return normalized;
}

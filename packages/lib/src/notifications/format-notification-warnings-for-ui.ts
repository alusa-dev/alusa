export type NotificationWarningForUi = {
  channel: string;
  message: string;
  code?: string;
};

const CHANNEL_LABELS: Record<string, string> = {
  email: 'E-mail',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
};

export function formatNotificationWarningsForUi(
  warnings: NotificationWarningForUi[],
): string[] {
  return warnings.map((warning) => {
    const channelKey = warning.channel.toLowerCase();
    const channelLabel = CHANNEL_LABELS[channelKey] ?? warning.channel;
    const message = warning.message?.trim();
    if (message) return message;
    return warning.code
      ? `Falha ao sincronizar ${channelLabel} (${warning.code})`
      : `Falha ao sincronizar ${channelLabel}`;
  });
}

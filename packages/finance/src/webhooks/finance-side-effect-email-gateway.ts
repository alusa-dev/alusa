export type EventMapBankSlipRefundNotice = {
  orderId: string;
  buyerEmail: string;
  buyerName: string;
  eventName: string;
  requestUrl: string;
};

export type FinanceSideEffectEmailGateway = {
  sendBankSlipRefundNotice: (notice: EventMapBankSlipRefundNotice) => Promise<{ id: string | null }>;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function sendBankSlipRefundNotice(notice: EventMapBankSlipRefundNotice): Promise<{ id: string | null }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY ausente; e-mail de estorno não foi enviado.');

  const buyerName = escapeHtml(notice.buyerName);
  const eventName = escapeHtml(notice.eventName);
  const requestUrl = escapeHtml(notice.requestUrl);
  const supportUrlValue = process.env.EMAIL_SUPPORT_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://alusa.app';
  const supportUrl = escapeHtml(supportUrlValue);
  const subject = `Ação necessária para concluir o estorno — ${notice.eventName}`;
  const text = [
    `Olá, ${notice.buyerName}.`,
    '',
    `O pagamento do pedido de ingressos para ${notice.eventName} foi confirmado depois que os assentos deixaram de estar disponíveis. Não emitimos ingressos para este pedido.`,
    '',
    'Para receber o estorno do boleto, preencha os dados solicitados pelo Asaas neste link seguro:',
    notice.requestUrl,
    '',
    `Se precisar de ajuda, fale com a instituição: ${supportUrlValue}`,
  ].join('\n');
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#f6f3ee;padding:32px;color:#1f2937;">
      <div style="max-width:580px;margin:0 auto;background:#ffffff;border:1px solid #e7ddd0;border-radius:18px;padding:30px;">
        <p style="margin:0 0 10px;font-size:13px;color:#7c6f60;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">alusa eventos</p>
        <h1 style="margin:0 0 14px;font-size:24px;line-height:1.25;color:#271a10;">Precisamos de uma informação para devolver o pagamento</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Olá, ${buyerName}. O pagamento do pedido para <strong>${eventName}</strong> foi confirmado depois que os assentos deixaram de estar disponíveis. Não emitimos ingressos para este pedido.</p>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#475569;">Para concluir o estorno do boleto, informe os dados solicitados pelo Asaas na página segura:</p>
        <p style="margin:0 0 20px;"><a href="${requestUrl}" style="display:inline-block;padding:13px 20px;border-radius:10px;background:#3e1f63;color:#ffffff;text-decoration:none;font-weight:700;">Informar dados para o estorno</a></p>
        <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">Se precisar de ajuda, fale com a instituição em <a href="${supportUrl}" style="color:#3e1f63;">${supportUrl}</a>.</p>
      </div>
    </div>
  `;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `event-map-late-boleto-refund:${notice.orderId}`,
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM_EVENTS || process.env.EMAIL_FROM_AUTH || 'Alusa <onboarding@resend.dev>',
      to: [notice.buyerEmail],
      subject,
      html,
      text,
      tags: [
        { name: 'category', value: 'event_map_refund' },
        { name: 'order_id', value: notice.orderId },
      ],
    }),
  });
  const responseBody = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(
      typeof responseBody?.message === 'string'
        ? responseBody.message
        : `Falha ao enviar e-mail de estorno (${response.status}).`,
    ) as Error & { status: number };
    error.status = response.status;
    throw error;
  }

  return { id: typeof responseBody?.id === 'string' ? responseBody.id : null };
}

const productionGateway: FinanceSideEffectEmailGateway = {
  sendBankSlipRefundNotice,
};

let testGateway: FinanceSideEffectEmailGateway | null = null;

export function registerFinanceSideEffectEmailGatewayForTests(gateway: FinanceSideEffectEmailGateway): void {
  if (process.env.PLAYWRIGHT_TEST !== 'true') {
    throw new Error('The finance email test gateway is only available in Playwright tests.');
  }
  testGateway = gateway;
}

export function getFinanceSideEffectEmailGateway(): FinanceSideEffectEmailGateway {
  return testGateway ?? productionGateway;
}

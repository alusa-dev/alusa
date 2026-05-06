import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import Twilio from 'twilio';
import { formatarNumeroWhatsApp } from '@/lib/utils/whatsapp';
import { safeGetServerSession } from '@/lib/safe-server-session';

/**
 * Schema de validação para envio de mensagens
 * Aceita número em qualquer formato (será formatado automaticamente)
 */
const sendMessageSchema = z.object({
  numero: z.string().min(1, 'Número de destino é obrigatório'),
  mensagem: z.string().optional(),
});

type SendMessageInput = z.infer<typeof sendMessageSchema>;
type SessionUser = { id?: string | null; contaId?: string | null };

/**
 * POST /api/twilio/send
 * Envia mensagem via Twilio WhatsApp
 *
 * Body:
 * {
 *   "numero": "(97) 98110-6749" | "97981106749" | "+5597981106749",
 *   "mensagem": "Mensagem opcional"
 * }
 *
 * O número é automaticamente formatado para whatsapp:+55DDDNÚMERO
 *
 * Response (sucesso):
 * {
 *   "success": true,
 *   "sid": "SM123...",
 *   "status": "sent",
 *   "to": "whatsapp:+5597981106749"
 * }
 *
 * Response (erro):
 * {
 *   "error": "Mensagem de erro",
 *   "code": 21211,
 *   "details": {...}
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await safeGetServerSession();
    const user = (session as { user?: SessionUser } | null)?.user;

    if (!user?.id || !user?.contaId) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // 1. Validar variáveis de ambiente
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const apiKeySid = process.env.TWILIO_API_KEY_SID;
    const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;

    // Validar se temos credenciais válidas (Auth Token OU API Key)
    const hasAuthToken = !!accountSid && !!authToken;
    const hasApiKey = !!accountSid && !!apiKeySid && !!apiKeySecret;

    if (!accountSid || !fromNumber || (!hasAuthToken && !hasApiKey)) {
      console.error('[Twilio] ❌ Variáveis de ambiente ausentes:', {
        hasAccountSid: !!accountSid,
        hasAuthToken: !!authToken,
        hasApiKeySid: !!apiKeySid,
        hasApiKeySecret: !!apiKeySecret,
        hasFromNumber: !!fromNumber,
      });
      return NextResponse.json(
        {
          error:
            'Configuração Twilio incompleta. Verifique as variáveis de ambiente no arquivo .env.local',
          details:
            'Necessário: TWILIO_ACCOUNT_SID + TWILIO_FROM_NUMBER + (TWILIO_AUTH_TOKEN OU TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET)',
        },
        { status: 500 },
      );
    }

    // 2. Parsear e validar body
    const body: unknown = await req.json().catch(() => ({}));

    const validation = sendMessageSchema.safeParse(body);

    if (!validation.success) {
      const firstError = validation.error.errors[0];
      console.error('[Twilio] ❌ Erro de validação:', validation.error.errors);
      return NextResponse.json(
        {
          error: firstError?.message || 'Dados inválidos',
          details: validation.error.errors,
        },
        { status: 400 },
      );
    }

    const { numero, mensagem } = validation.data as SendMessageInput;

    // 3. Formatar número para padrão Twilio (whatsapp:+55DDDNÚMERO)
    let numeroFormatado: string;
    try {
      numeroFormatado = formatarNumeroWhatsApp(numero);
    } catch (error) {
      console.error('[Twilio] Erro ao formatar número:', {
        message: error instanceof Error ? error.message : 'Formato inválido',
      });
      return NextResponse.json(
        {
          error: 'Número inválido',
          message: error instanceof Error ? error.message : 'Formato de número inválido',
        },
        { status: 400 },
      );
    }

    // 4. Criar cliente Twilio
    // Usar API Key se disponível (mais seguro), senão usar Auth Token
    let client;
    if (apiKeySid && apiKeySecret) {
      client = Twilio(apiKeySid, apiKeySecret, { accountSid });
    } else {
      client = Twilio(accountSid, authToken);
    }

    // 5. Enviar mensagem
    const messageBody = mensagem || 'Olá do Alusa 👋 (teste Twilio WhatsApp)';

    const message = await client.messages.create({
      from: fromNumber,
      to: numeroFormatado,
      body: messageBody,
    });

    console.log('[Twilio] Mensagem enviada', {
      contaId: user.contaId,
      actorId: user.id,
      sid: message.sid,
      status: message.status,
    });

    return NextResponse.json({
      success: true,
      sid: message.sid,
      status: 'sent',
      to: message.to,
    });
  } catch (error) {
    // Erros específicos do Twilio
    if (error && typeof error === 'object' && 'code' in error) {
      const twilioError = error as {
        code: number;
        status?: number;
      };
      console.error('[Twilio] Erro Twilio:', {
        code: twilioError.code,
        status: twilioError.status,
      });

      return NextResponse.json(
        {
          error: 'Erro ao enviar mensagem via Twilio',
          code: twilioError.code,
        },
        { status: twilioError.status || 400 },
      );
    }

    console.error('[Twilio] Erro inesperado ao enviar mensagem', {
      name: error instanceof Error ? error.name : 'UnknownError',
    });

    return NextResponse.json(
      {
        error: 'Erro ao enviar mensagem',
      },
      { status: 500 },
    );
  }
}

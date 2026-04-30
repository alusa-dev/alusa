import { Resend } from 'resend';

export type EmailCategory = 'invite_user' | 'verify_email' | 'reset_password' | 'account_reactivation';

export type SendTransactionalEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  category: EmailCategory;
  idempotencyKey: string;
  from?: string;
  tags?: Array<{ name: string; value: string }>;
  actionUrl?: string;
};

export type SendTransactionalEmailResult = {
  delivery: 'sent' | 'logged';
  emailId: string | null;
};

let resendClient: Resend | null | undefined;

function getResendClient(): Resend | null {
  if (resendClient !== undefined) {
    return resendClient;
  }

  resendClient = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  return resendClient;
}

function getDefaultFrom(category: EmailCategory): string {
  if (category === 'invite_user') {
    return process.env.EMAIL_FROM_INVITES || process.env.EMAIL_FROM_AUTH || 'Alusa <onboarding@resend.dev>';
  }

  return process.env.EMAIL_FROM_AUTH || 'Alusa <onboarding@resend.dev>';
}

function canFallbackToLog(error: unknown): boolean {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }

  if (!process.env.RESEND_API_KEY) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error || '');
  return message.includes('You can only send testing emails to your own email address');
}

function logEmail(input: SendTransactionalEmailInput): void {
  console.info('[EMAIL][DEV_FALLBACK]');
  console.info(`category: ${input.category}`);
  console.info(`to: ${input.to}`);
  console.info(`subject: ${input.subject}`);
  if (input.actionUrl) {
    console.info(`actionUrl: ${input.actionUrl}`);
  }
  console.info(`idempotencyKey: ${input.idempotencyKey}`);
}

export async function sendTransactionalEmail(
  input: SendTransactionalEmailInput,
): Promise<SendTransactionalEmailResult> {
  const resend = getResendClient();

  if (!resend) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('RESEND_API_KEY ausente em produção.');
    }

    logEmail(input);
    return { delivery: 'logged', emailId: null };
  }

  try {
    const { data, error } = await resend.emails.send(
      {
        from: input.from || getDefaultFrom(input.category),
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        tags: input.tags,
      },
      {
        idempotencyKey: input.idempotencyKey,
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    return { delivery: 'sent', emailId: data?.id ?? null };
  } catch (error) {
    if (canFallbackToLog(error)) {
      logEmail(input);
      return { delivery: 'logged', emailId: null };
    }

    throw error;
  }
}

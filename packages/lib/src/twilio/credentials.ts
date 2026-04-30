/**
 * Twilio Integration - Credentials Management
 *
 * Gerenciamento seguro de credenciais Twilio com suporte a:
 * - Variáveis de ambiente
 * - Armazenamento criptografado no banco de dados
 * - Múltiplos métodos de autenticação (Auth Token vs API Key)
 *
 * @module lib/twilio/credentials
 */

// Imports relativos - ajustar conforme estrutura do projeto
// import { prisma } from '@/lib/db/prisma';
// import { encrypt, decrypt } from '@/lib/utils/encryption';

// TODO: Implementar quando estrutura de banco e criptografia estiver disponível
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma: any = null;
const encrypt = (data: string): string => data; // Placeholder
const decrypt = (data: string): string => data; // Placeholder
import { twilioCredentialsSchema, type TwilioCredentials } from './schemas';

/**
 * Busca credenciais Twilio do banco de dados
 *
 * As credenciais são armazenadas criptografadas na tabela de configurações.
 *
 * @returns Credenciais Twilio ou null se não encontradas
 * @throws Error se houver problema ao descriptografar
 *
 * @example
 * ```ts
 * const creds = await getTwilioCredentials();
 * if (creds) {
 *   const service = new TwilioService(creds);
 * }
 * ```
 */
export async function getTwilioCredentials(): Promise<TwilioCredentials | null> {
  try {
    // Buscar credenciais do banco (tabela de configurações)
    const config = await prisma.configuracao.findUnique({
      where: { chave: 'twilio_credentials' },
    });

    if (!config || !config.valor) {
      return null;
    }

    // Descriptografar e validar
    const decrypted = decrypt(config.valor);
    const parsed = JSON.parse(decrypted);
    const credentials = twilioCredentialsSchema.parse(parsed);

    return credentials;
  } catch (error) {
    console.error('[Twilio Credentials] Erro ao buscar credenciais:', error);
    return null;
  }
}

/**
 * Salva credenciais Twilio no banco de dados (criptografadas)
 *
 * @param credentials - Credenciais a serem salvas
 * @returns true se salvou com sucesso
 *
 * @example
 * ```ts
 * await saveTwilioCredentials({
 *   accountSid: 'ACxxx',
 *   authToken: 'xxx',
 *   fromNumber: 'whatsapp:+14155238886'
 * });
 * ```
 */
export async function saveTwilioCredentials(credentials: TwilioCredentials): Promise<boolean> {
  try {
    // Validar credenciais
    const validated = twilioCredentialsSchema.parse(credentials);

    // Criptografar
    const encrypted = encrypt(JSON.stringify(validated));

    // Salvar no banco
    await prisma.configuracao.upsert({
      where: { chave: 'twilio_credentials' },
      update: {
        valor: encrypted,
        updatedAt: new Date(),
      },
      create: {
        chave: 'twilio_credentials',
        valor: encrypted,
        descricao: 'Credenciais da API Twilio (criptografadas)',
      },
    });

    return true;
  } catch (error) {
    console.error('[Twilio Credentials] Erro ao salvar credenciais:', error);
    return false;
  }
}

/**
 * Remove credenciais Twilio do banco de dados
 *
 * @returns true se removeu com sucesso
 */
export async function deleteTwilioCredentials(): Promise<boolean> {
  try {
    await prisma.configuracao.delete({
      where: { chave: 'twilio_credentials' },
    });
    return true;
  } catch (error) {
    console.error('[Twilio Credentials] Erro ao deletar credenciais:', error);
    return false;
  }
}

/**
 * Verifica se credenciais Twilio estão configuradas
 *
 * Verifica tanto no banco quanto em variáveis de ambiente
 *
 * @returns true se credenciais estão disponíveis
 */
export async function hasTwilioCredentials(): Promise<boolean> {
  // Verificar variáveis de ambiente primeiro (prioridade)
  if (
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_FROM_NUMBER &&
    (process.env.TWILIO_AUTH_TOKEN ||
      (process.env.TWILIO_API_KEY_SID && process.env.TWILIO_API_KEY_SECRET))
  ) {
    return true;
  }

  // Verificar banco de dados
  const dbCredentials = await getTwilioCredentials();
  return dbCredentials !== null;
}

/**
 * Obtém credenciais Twilio de variáveis de ambiente
 *
 * Fallback se não houver credenciais no banco
 *
 * @returns Credenciais ou null se não configuradas
 */
export function getTwilioCredentialsFromEnv(): TwilioCredentials | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !fromNumber) {
    return null;
  }

  if (!authToken && (!apiKeySid || !apiKeySecret)) {
    return null;
  }

  try {
    return twilioCredentialsSchema.parse({
      accountSid,
      authToken,
      apiKeySid,
      apiKeySecret,
      fromNumber,
    });
  } catch {
    return null;
  }
}

/**
 * Obtém credenciais Twilio (banco ou env)
 *
 * Ordem de prioridade:
 * 1. Variáveis de ambiente
 * 2. Banco de dados
 *
 * @returns Credenciais ou null
 */
export async function getTwilioCredentialsAny(): Promise<TwilioCredentials | null> {
  // Tentar env primeiro
  const envCreds = getTwilioCredentialsFromEnv();
  if (envCreds) {
    return envCreds;
  }

  // Fallback para banco
  return getTwilioCredentials();
}

/**
 * Valida e testa credenciais Twilio
 *
 * Faz uma chamada real à API para verificar se as credenciais funcionam
 *
 * @param credentials - Credenciais a testar
 * @returns true se credenciais são válidas
 */
export async function validateTwilioCredentials(credentials: TwilioCredentials): Promise<boolean> {
  try {
    // Importação dinâmica para evitar erro em build time
    const { TwilioService } = await import('./service');

    const service = new TwilioService({
      accountSid: credentials.accountSid,
      authToken: credentials.authToken,
      apiKeySid: credentials.apiKeySid,
      apiKeySecret: credentials.apiKeySecret,
      fromNumber: credentials.fromNumber,
    });

    // Testar conexão
    return await service.testConnection();
  } catch (error) {
    console.error('[Twilio Credentials] Erro ao validar credenciais:', error);
    return false;
  }
}

/**
 * Atualiza apenas o número "from" das credenciais
 *
 * @param newFromNumber - Novo número de origem
 * @returns true se atualizou com sucesso
 */
export async function updateTwilioFromNumber(newFromNumber: string): Promise<boolean> {
  try {
    const current = await getTwilioCredentials();
    if (!current) {
      throw new Error('Credenciais Twilio não encontradas');
    }

    const updated: TwilioCredentials = {
      ...current,
      fromNumber: newFromNumber,
    };

    return await saveTwilioCredentials(updated);
  } catch (error) {
    console.error('[Twilio Credentials] Erro ao atualizar from number:', error);
    return false;
  }
}

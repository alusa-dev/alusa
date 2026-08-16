/**
 * Validação de variáveis de ambiente de segurança.
 *
 * Deve ser chamado no boot da aplicação para fail-fast em caso de
 * configuração ausente ou inválida.
 */

export interface EnvValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const KEY_VERSION_PATTERN = /^[A-Za-z0-9._-]+$/;

function parseEncryptionKey(raw: string): Buffer {
  return /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
}

/**
 * Valida que ENCRYPTION_KEY existe e tem tamanho adequado para AES-256.
 * AES-256-GCM requer chave de 32 bytes (256 bits).
 */
export function validateEncryptionKey(): EnvValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const key = process.env.ENCRYPTION_KEY;

  if (!key) {
    errors.push('ENCRYPTION_KEY não definida. API keys Asaas não poderão ser descriptografadas.');
    return { valid: false, errors, warnings };
  }

  // Tentar decodificar como base64 ou hex
  let keyBytes: Buffer;
  if (/^[0-9a-f]{64}$/i.test(key)) {
    keyBytes = Buffer.from(key, 'hex');
  } else {
    keyBytes = Buffer.from(key, 'base64');
  }

  if (keyBytes.length !== 32) {
    errors.push(`ENCRYPTION_KEY tem ${keyBytes.length} bytes, esperado 32 (AES-256).`);
  }

  if (key === 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' && process.env.NODE_ENV === 'production') {
    warnings.push('ENCRYPTION_KEY parece ser um placeholder de desenvolvimento. Substitua por uma chave única em produção.');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Valida a versão ativa e as chaves antigas usadas durante uma rotação.
 * ENCRYPTION_KEYRING é um objeto JSON { "versao": "chave" }.
 */
export function validateEncryptionKeyRing(): EnvValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const activeVersion = process.env.ENCRYPTION_KEY_VERSION?.trim() || '1';

  if (!KEY_VERSION_PATTERN.test(activeVersion)) {
    errors.push('ENCRYPTION_KEY_VERSION inválida. Use apenas letras, números, ponto, hífen ou sublinhado.');
  }

  const ring = process.env.ENCRYPTION_KEYRING?.trim();
  if (!ring) return { valid: errors.length === 0, errors, warnings };

  try {
    const parsed = JSON.parse(ring) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('objeto esperado');
    }

    for (const [version, value] of Object.entries(parsed)) {
      if (!KEY_VERSION_PATTERN.test(version) || typeof value !== 'string') {
        throw new Error('versão ou chave inválida');
      }
      if (parseEncryptionKey(value.trim()).length !== 32) {
        throw new Error(`chave inválida na versão ${version}`);
      }
    }
  } catch (error) {
    errors.push(`ENCRYPTION_KEYRING inválido: ${error instanceof Error ? error.message : 'objeto JSON esperado'}.`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Valida todas as variáveis de ambiente críticas para o módulo financeiro.
 */
export function validateFinanceEnv(): EnvValidationResult {
  const results: EnvValidationResult[] = [validateEncryptionKey(), validateEncryptionKeyRing()];

  const errors = results.flatMap((r) => r.errors);
  const warnings = results.flatMap((r) => r.warnings);

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Executa validação e loga resultados. Não lança — apenas alerta.
 */
export function assertFinanceEnvOnBoot(): void {
  const result = validateFinanceEnv();

  for (const w of result.warnings) {
    console.warn(`[finance-env] ⚠️ ${w}`);
  }

  for (const e of result.errors) {
    console.error(`[finance-env] ❌ ${e}`);
  }

  if (!result.valid) {
    console.error('[finance-env] Variáveis de ambiente críticas ausentes ou inválidas. Verifique a configuração.');
  }
}

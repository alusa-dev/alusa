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
 * Valida todas as variáveis de ambiente críticas para o módulo financeiro.
 */
export function validateFinanceEnv(): EnvValidationResult {
  const results: EnvValidationResult[] = [validateEncryptionKey()];

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

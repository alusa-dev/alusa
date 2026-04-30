/**
 * Guardrails de segurança SQL
 * Valida e sanitiza queries antes da execução
 */

import type { QuestionAnalysis } from './types.js';

// Palavras-chave proibidas (destrutivas)
const FORBIDDEN_KEYWORDS = [
  'DELETE',
  'UPDATE',
  'INSERT',
  'DROP',
  'ALTER',
  'TRUNCATE',
  'GRANT',
  'REVOKE',
  'COPY',
  'CREATE',
  'VACUUM',
  'REINDEX',
  'CLUSTER',
  'REFRESH',
  'LOCK',
  'UNLISTEN',
  'NOTIFY',
  'EXECUTE',
  'PREPARE',
  'DEALLOCATE',
];

// Padrões de pergunta destrutiva (PT-BR e EN)
const DESTRUCTIVE_PATTERNS = [
  /\b(apag[aue]|delet[aeo]|remov[aeo]|exclu[aio])/i,
  /\b(atualiz[aeo]|updat[eo]|modifi[cq])/i,
  /\b(insert|adiciona|inclui)/i,
  /\b(drop|derrubar|destruir)/i,
  /\b(truncat[eo]|limpar?\s+tabel[ao])/i,
];

// Padrões de pergunta sobre estrutura
const STRUCTURE_PATTERNS = [
  /\b(quais?\s+tabel[ao]s?|list[aeo]\s+tabel)/i,
  /\b(estrutura|schema|esquema|metadados)/i,
  /\b(coluna[s]?\s+(d[oae]|exist))/i,
  /\b(relacionamento[s]?|foreign\s+key|chave\s+estrangeira)/i,
  /\b(descrev[aeo]|descrever|describe)/i,
  /\b(what\s+tables|list\s+tables|show\s+tables)/i,
  /\b(quais\s+campos|campos\s+d[oae])/i,
];

// Schemas permitidos (allowlist) - configurável
let allowedSchemas: string[] | null = null;

/**
 * Configura schemas permitidos
 */
export function setAllowedSchemas(schemas: string[] | null): void {
  allowedSchemas = schemas;
  if (schemas) {
    console.error(`[alusadb] Schemas permitidos: ${schemas.join(', ')}`);
  }
}

/**
 * Verifica se um schema é permitido
 */
export function isSchemaAllowed(schema: string): boolean {
  if (!allowedSchemas) return true;
  return allowedSchemas.includes(schema);
}

/**
 * Remove comentários SQL
 */
function removeComments(sql: string): string {
  // Remove comentários de linha
  let clean = sql.replace(/--.*$/gm, '');
  // Remove comentários de bloco
  clean = clean.replace(/\/\*[\s\S]*?\*\//g, '');
  return clean;
}

/**
 * Normaliza SQL para análise
 */
function normalizeSql(sql: string): string {
  return removeComments(sql)
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * Valida se o SQL contém apenas operações permitidas
 */
export function validateSql(sql: string): { valid: boolean; error?: string } {
  const normalized = normalizeSql(sql);
  
  // Verifica keywords proibidas
  for (const keyword of FORBIDDEN_KEYWORDS) {
    // Regex para encontrar a keyword como palavra completa
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(normalized)) {
      return {
        valid: false,
        error: `Operação '${keyword}' não permitida. Este MCP opera apenas em modo leitura (SELECT).`,
      };
    }
  }
  
  // Verifica se começa com SELECT ou WITH (CTE)
  if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
    return {
      valid: false,
      error: 'Apenas consultas SELECT e CTEs (WITH) são permitidas.',
    };
  }
  
  return { valid: true };
}

/**
 * Adiciona LIMIT à query se não existir
 */
export function ensureLimit(sql: string, maxRows: number): string {
  const normalized = normalizeSql(sql);
  
  // Verifica se já tem LIMIT
  if (normalized.includes('LIMIT')) {
    return sql;
  }
  
  // Adiciona LIMIT no final
  return `${sql.trim()} LIMIT ${maxRows}`;
}

/**
 * Analisa o tipo de pergunta
 */
export function analyzeQuestion(question: string): QuestionAnalysis {
  // Verifica se é destrutiva
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(question)) {
      return {
        type: 'forbidden',
        errorMessage: 'Operação não permitida. Este MCP opera apenas em modo leitura (SELECT). Não é possível modificar, deletar ou inserir dados.',
      };
    }
  }
  
  // Verifica se é sobre estrutura
  for (const pattern of STRUCTURE_PATTERNS) {
    if (pattern.test(question)) {
      return { type: 'structure' };
    }
  }
  
  // Default: consulta de dados
  return { type: 'data' };
}

/**
 * Gera SQL seguro a partir de uma pergunta simples
 * (heurísticas básicas - a LLM pode melhorar isso)
 */
export function generateBasicSql(
  question: string,
  tables: string[],
  maxRows: number
): string | null {
  const q = question.toLowerCase();
  
  // Contagem
  if (/\b(quantos?|conta[rg]?|count|total)\b/.test(q)) {
    for (const table of tables) {
      if (q.includes(table.toLowerCase())) {
        return `SELECT COUNT(*) as total FROM "${table}" LIMIT ${maxRows}`;
      }
    }
    // Se não encontrou tabela específica
    return null;
  }
  
  // Listagem
  if (/\b(list[aeo]|mostre?|exib[aio]|show|selecione)\b/.test(q)) {
    for (const table of tables) {
      if (q.includes(table.toLowerCase())) {
        return `SELECT * FROM "${table}" LIMIT ${maxRows}`;
      }
    }
  }
  
  // Não conseguiu gerar SQL básico
  return null;
}

/**
 * Sanitiza input para prevenir injection básico
 */
export function sanitizeInput(input: string): string {
  // Remove caracteres perigosos
  return input
    .replace(/[;'"\\]/g, '')
    .trim()
    .substring(0, 1000); // Limita tamanho
}

/**
 * Valida SQL completo antes de executar
 */
export function prepareQuery(
  sql: string,
  maxRows: number
): { sql: string; valid: boolean; error?: string } {
  // Valida SQL
  const validation = validateSql(sql);
  if (!validation.valid) {
    return { sql, valid: false, error: validation.error };
  }
  
  // Garante LIMIT
  const safeSql = ensureLimit(sql, maxRows);
  
  return { sql: safeSql, valid: true };
}

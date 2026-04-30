/**
 * Tipos compartilhados do MCP alusadb
 */

// Estrutura de coluna do banco
export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  references?: {
    table: string;
    column: string;
  };
}

// Estrutura de tabela do banco
export interface TableInfo {
  table: string;
  schema: string;
  columns: ColumnInfo[];
  rowCount?: number;
}

// Estrutura de schema do banco
export interface SchemaInfo {
  schema: string;
  tables: TableInfo[];
}

// Cache de introspecção
export interface IntrospectionCache {
  schemas: SchemaInfo[];
  lastUpdated: Date;
  ttlMs: number;
}

// Input da tool alusadb
export interface AlusaDbInput {
  question: string;
  maxRows?: number;
  schema?: string;
}

// Resultado de query
export interface QueryResult {
  columns: Array<{ name: string; type: string }>;
  rows: Record<string, unknown>[];
  rowCount: number;
  sql: string;
  executionTimeMs: number;
}

// Tipos de conteúdo MCP
export type McpContentType = 'text' | 'json' | 'meta' | 'error';

export interface McpContentItem {
  type: McpContentType;
  text?: string;
  data?: unknown;
}

export interface McpToolResponse {
  content: McpContentItem[];
}

// Tipo de pergunta detectada
export type QuestionType = 'structure' | 'data' | 'forbidden';

// Resultado da análise de pergunta
export interface QuestionAnalysis {
  type: QuestionType;
  suggestedSql?: string;
  errorMessage?: string;
}

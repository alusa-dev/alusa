/**
 * Introspecção do banco PostgreSQL
 * Carrega metadados de schemas, tabelas, colunas e relacionamentos
 */

import { executeQuery } from './db.js';
import type { SchemaInfo, TableInfo, ColumnInfo, IntrospectionCache } from './types.js';

// Cache de introspecção
let cache: IntrospectionCache | null = null;

// TTL padrão: 60 segundos
const DEFAULT_TTL_MS = 60000;

/**
 * Verifica se o cache está válido
 */
function isCacheValid(): boolean {
  if (!cache) return false;
  const now = Date.now();
  const cacheAge = now - cache.lastUpdated.getTime();
  return cacheAge < cache.ttlMs;
}

/**
 * Carrega colunas de uma tabela específica
 */
async function loadColumns(schema: string, table: string): Promise<ColumnInfo[]> {
  const sql = `
    SELECT 
      c.column_name,
      c.data_type,
      c.is_nullable,
      c.column_default,
      CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key,
      CASE WHEN fk.column_name IS NOT NULL THEN true ELSE false END as is_foreign_key,
      fk.foreign_table_name,
      fk.foreign_column_name
    FROM information_schema.columns c
    LEFT JOIN (
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = $1
        AND tc.table_name = $2
    ) pk ON pk.column_name = c.column_name
    LEFT JOIN (
      SELECT
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = $1
        AND tc.table_name = $2
    ) fk ON fk.column_name = c.column_name
    WHERE c.table_schema = $1 AND c.table_name = $2
    ORDER BY c.ordinal_position
  `;

  const result = await executeQuery(sql, [schema, table]);

  return result.rows.map((row) => {
    const col: ColumnInfo = {
      name: row.column_name as string,
      type: row.data_type as string,
      nullable: row.is_nullable === 'YES',
      defaultValue: row.column_default as string | null,
      isPrimaryKey: row.is_primary_key as boolean,
      isForeignKey: row.is_foreign_key as boolean,
    };

    if (col.isForeignKey && row.foreign_table_name) {
      col.references = {
        table: row.foreign_table_name as string,
        column: row.foreign_column_name as string,
      };
    }

    return col;
  });
}

/**
 * Carrega contagem aproximada de linhas (rápido, usando estatísticas)
 */
async function getApproximateRowCount(schema: string, table: string): Promise<number | undefined> {
  try {
    const sql = `
      SELECT reltuples::bigint AS estimate
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2
    `;
    const result = await executeQuery(sql, [schema, table]);
    const estimate = result.rows[0]?.estimate as number | undefined;
    return estimate && estimate >= 0 ? estimate : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Carrega todas as tabelas de um schema
 */
async function loadTables(schema: string): Promise<TableInfo[]> {
  const sql = `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = $1
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;

  const result = await executeQuery(sql, [schema]);
  const tables: TableInfo[] = [];

  for (const row of result.rows) {
    const tableName = row.table_name as string;
    const columns = await loadColumns(schema, tableName);
    const rowCount = await getApproximateRowCount(schema, tableName);

    tables.push({
      table: tableName,
      schema,
      columns,
      rowCount,
    });
  }

  return tables;
}

/**
 * Lista todos os schemas do banco (excluindo internos)
 */
async function listSchemas(filterSchema?: string): Promise<string[]> {
  const excludedSchemas = ['pg_catalog', 'information_schema', 'pg_toast'];
  
  let sql = `
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name NOT IN (${excludedSchemas.map((_, i) => `$${i + 1}`).join(', ')})
  `;
  
  const params: string[] = [...excludedSchemas];
  
  if (filterSchema) {
    sql += ` AND schema_name = $${params.length + 1}`;
    params.push(filterSchema);
  }
  
  sql += ' ORDER BY schema_name';

  const result = await executeQuery(sql, params);
  return result.rows.map((row) => row.schema_name as string);
}

/**
 * Carrega toda a estrutura do banco
 */
export async function loadDatabaseStructure(
  filterSchema?: string,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<SchemaInfo[]> {
  // Retorna cache se válido
  if (isCacheValid() && (!filterSchema || cache!.schemas.some(s => s.schema === filterSchema))) {
    console.error('[alusadb] Usando cache de introspecção');
    if (filterSchema) {
      return cache!.schemas.filter(s => s.schema === filterSchema);
    }
    return cache!.schemas;
  }

  console.error('[alusadb] Carregando estrutura do banco...');
  const startTime = Date.now();

  const schemas = await listSchemas(filterSchema);
  const result: SchemaInfo[] = [];

  for (const schema of schemas) {
    const tables = await loadTables(schema);
    result.push({ schema, tables });
  }

  // Atualiza cache
  cache = {
    schemas: result,
    lastUpdated: new Date(),
    ttlMs,
  };

  const elapsed = Date.now() - startTime;
  console.error(`[alusadb] Estrutura carregada em ${elapsed}ms (${result.length} schemas)`);

  return result;
}

/**
 * Invalida o cache manualmente
 */
export function invalidateCache(): void {
  cache = null;
  console.error('[alusadb] Cache de introspecção invalidado');
}

/**
 * Retorna o cache atual (para debug)
 */
export function getCache(): IntrospectionCache | null {
  return cache;
}

/**
 * Busca uma tabela específica pelo nome
 */
export async function findTable(
  tableName: string,
  schema?: string
): Promise<TableInfo | null> {
  const structures = await loadDatabaseStructure(schema);
  
  for (const s of structures) {
    const table = s.tables.find(t => t.table.toLowerCase() === tableName.toLowerCase());
    if (table) return table;
  }
  
  return null;
}

/**
 * Busca tabelas que contenham uma coluna específica
 */
export async function findTablesWithColumn(
  columnName: string,
  schema?: string
): Promise<TableInfo[]> {
  const structures = await loadDatabaseStructure(schema);
  const results: TableInfo[] = [];
  
  for (const s of structures) {
    for (const table of s.tables) {
      if (table.columns.some(c => c.name.toLowerCase() === columnName.toLowerCase())) {
        results.push(table);
      }
    }
  }
  
  return results;
}

/**
 * Gera um resumo textual do schema para a LLM
 */
export async function generateSchemaDescription(schema?: string): Promise<string> {
  const structures = await loadDatabaseStructure(schema);
  const lines: string[] = [];
  
  for (const s of structures) {
    lines.push(`\n## Schema: ${s.schema}`);
    
    for (const table of s.tables) {
      const rowInfo = table.rowCount !== undefined ? ` (~${table.rowCount} rows)` : '';
      lines.push(`\n### Tabela: ${table.table}${rowInfo}`);
      
      for (const col of table.columns) {
        let colDesc = `- ${col.name}: ${col.type}`;
        if (col.isPrimaryKey) colDesc += ' [PK]';
        if (col.isForeignKey && col.references) {
          colDesc += ` [FK -> ${col.references.table}.${col.references.column}]`;
        }
        if (!col.nullable) colDesc += ' NOT NULL';
        lines.push(colDesc);
      }
    }
  }
  
  return lines.join('\n');
}

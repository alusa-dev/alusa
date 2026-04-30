/**
 * Formatador de respostas para o padrão MCP
 */

import type {
  McpContentItem,
  McpToolResponse,
  SchemaInfo,
  QueryResult,
  TableInfo,
} from './types.js';

/**
 * Cria um item de conteúdo de texto
 */
export function textContent(text: string): McpContentItem {
  return { type: 'text', text };
}

/**
 * Cria um item de conteúdo JSON
 */
export function jsonContent(data: unknown): McpContentItem {
  return { type: 'json', data };
}

/**
 * Cria um item de conteúdo de metadados
 */
export function metaContent(data: unknown): McpContentItem {
  return { type: 'meta', data };
}

/**
 * Cria um item de conteúdo de erro
 */
export function errorContent(text: string): McpContentItem {
  return { type: 'error', text };
}

/**
 * Formata resposta de estrutura do banco
 */
export function formatStructureResponse(schemas: SchemaInfo[]): McpToolResponse {
  const totalTables = schemas.reduce((sum, s) => sum + s.tables.length, 0);
  const totalColumns = schemas.reduce(
    (sum, s) => sum + s.tables.reduce((tSum, t) => tSum + t.columns.length, 0),
    0
  );

  return {
    content: [
      textContent(
        `Estrutura do banco PostgreSQL detectada: ${schemas.length} schema(s), ${totalTables} tabela(s), ${totalColumns} coluna(s).`
      ),
      jsonContent({ schemas }),
    ],
  };
}

/**
 * Formata resposta de uma tabela específica
 */
export function formatTableResponse(table: TableInfo): McpToolResponse {
  const rowInfo = table.rowCount !== undefined ? ` (~${table.rowCount} linhas)` : '';
  
  return {
    content: [
      textContent(`Tabela "${table.table}" no schema "${table.schema}"${rowInfo}.`),
      jsonContent({
        table: table.table,
        schema: table.schema,
        columns: table.columns,
        rowCount: table.rowCount,
      }),
    ],
  };
}

/**
 * Formata resposta de query de dados
 */
export function formatQueryResponse(result: QueryResult): McpToolResponse {
  return {
    content: [
      textContent(`Consulta executada com sucesso. ${result.rowCount} linha(s) retornada(s).`),
      jsonContent({
        columns: result.columns,
        rows: result.rows,
        rowCount: result.rowCount,
      }),
      metaContent({
        sql: result.sql,
        executionTimeMs: result.executionTimeMs,
      }),
    ],
  };
}

/**
 * Formata resposta de erro
 */
export function formatErrorResponse(
  message: string,
  details?: { sql?: string; originalError?: string }
): McpToolResponse {
  const content: McpContentItem[] = [errorContent(message)];
  
  if (details) {
    content.push(metaContent(details));
  }
  
  return { content };
}

/**
 * Formata resposta de operação proibida
 */
export function formatForbiddenResponse(message: string): McpToolResponse {
  return {
    content: [
      errorContent(message),
      textContent(
        'Este MCP opera em modo somente leitura. Use consultas SELECT para obter dados. ' +
        'Para modificações no banco, utilize ferramentas administrativas adequadas.'
      ),
    ],
  };
}

/**
 * Formata resposta quando não há resultados
 */
export function formatEmptyResponse(sql: string, executionTimeMs: number): McpToolResponse {
  return {
    content: [
      textContent('Consulta executada com sucesso. Nenhum resultado encontrado.'),
      jsonContent({ columns: [], rows: [], rowCount: 0 }),
      metaContent({ sql, executionTimeMs }),
    ],
  };
}

/**
 * Converte resposta MCP para formato de texto (para tools que retornam text)
 */
export function responseToText(response: McpToolResponse): string {
  const parts: string[] = [];
  
  for (const item of response.content) {
    switch (item.type) {
      case 'text':
        parts.push(item.text || '');
        break;
      case 'json':
        parts.push('```json\n' + JSON.stringify(item.data, null, 2) + '\n```');
        break;
      case 'meta':
        parts.push('---\n**Metadados:** ' + JSON.stringify(item.data));
        break;
      case 'error':
        parts.push(`❌ **Erro:** ${item.text}`);
        break;
    }
  }
  
  return parts.join('\n\n');
}

/**
 * Serializa resposta MCP para JSON (formato nativo)
 */
export function serializeResponse(response: McpToolResponse): string {
  return JSON.stringify(response, null, 2);
}

#!/usr/bin/env node
/**
 * MCP Server: alusadb
 * Servidor MCP para consulta segura a banco PostgreSQL
 * 
 * Transporte: stdio (stdin/stdout)
 * Protocolo: Model Context Protocol
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { executeQuery, testConnection, closePool } from './db.js';
import {
  loadDatabaseStructure,
  findTable,
  generateSchemaDescription,
} from './introspection.js';
import {
  analyzeQuestion,
  prepareQuery,
  setAllowedSchemas,
} from './security.js';
import {
  formatStructureResponse,
  formatTableResponse,
  formatQueryResponse,
  formatErrorResponse,
  formatForbiddenResponse,
  formatEmptyResponse,
  responseToText,
} from './format.js';
import type { AlusaDbInput, QueryResult } from './types.js';

// Schema de validação do input
const AlusaDbInputSchema = z.object({
  question: z.string().min(1, 'Pergunta é obrigatória'),
  maxRows: z.number().int().positive().max(1000).optional().default(100),
  schema: z.string().optional(),
});

// Definição da tool
const ALUSADB_TOOL: Tool = {
  name: 'alusadb',
  description: `Ferramenta para consultar banco de dados PostgreSQL de forma segura.

Capacidades:
- Descobrir estrutura do banco (schemas, tabelas, colunas, tipos, chaves primárias/estrangeiras)
- Executar consultas SELECT baseadas em perguntas em linguagem natural
- Retornar dados estruturados com metadados

Limitações:
- Apenas operações de leitura (SELECT) são permitidas
- Queries destrutivas (DELETE, UPDATE, INSERT, DROP) são bloqueadas
- Limite máximo de 1000 linhas por consulta

Exemplos de perguntas:
- "Quais tabelas existem no banco?"
- "Descreva a estrutura da tabela usuarios"
- "Liste os 10 primeiros registros da tabela clientes"
- "Quantos pedidos existem no sistema?"`,
  inputSchema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'Pergunta em linguagem natural sobre o banco de dados',
      },
      maxRows: {
        type: 'number',
        description: 'Número máximo de linhas a retornar (padrão: 100, máximo: 1000)',
        default: 100,
      },
      schema: {
        type: 'string',
        description: 'Schema específico para filtrar (opcional)',
      },
    },
    required: ['question'],
  },
};

/**
 * Processa uma pergunta sobre a estrutura do banco
 */
async function handleStructureQuestion(
  question: string,
  schema?: string
): Promise<string> {
  const q = question.toLowerCase();
  
  // Pergunta sobre tabelas específicas
  const tableMatch = q.match(/tabela\s+["']?(\w+)["']?|table\s+["']?(\w+)["']?/i);
  if (tableMatch) {
    const tableName = tableMatch[1] || tableMatch[2];
    const table = await findTable(tableName, schema);
    if (table) {
      return responseToText(formatTableResponse(table));
    }
    return responseToText(
      formatErrorResponse(`Tabela "${tableName}" não encontrada no banco.`)
    );
  }
  
  // Pergunta geral sobre estrutura
  const structures = await loadDatabaseStructure(schema);
  return responseToText(formatStructureResponse(structures));
}

/**
 * Processa uma pergunta sobre dados
 */
async function handleDataQuestion(
  question: string,
  maxRows: number,
  schema?: string
): Promise<string> {
  // Carrega estrutura para contexto
  const structures = await loadDatabaseStructure(schema);
  const schemaDesc = await generateSchemaDescription(schema);
  
  // Extrai nomes de tabelas para heurísticas
  const tableNames = structures.flatMap(s => s.tables.map(t => t.table));
  
  // Tenta identificar SQL na pergunta
  const sqlMatch = question.match(/```sql\s*([\s\S]*?)\s*```|SELECT\s+[\s\S]+/i);
  
  let sql: string | null = null;
  
  if (sqlMatch) {
    // SQL explícito na pergunta
    sql = sqlMatch[1] || sqlMatch[0];
  } else {
    // Precisa gerar SQL - usa heurísticas básicas ou indica que precisa da LLM
    const q = question.toLowerCase();
    
    // Heurística: contagem
    if (/\b(quantos?|conta[rg]?|count|total)\b/.test(q)) {
      for (const table of tableNames) {
        if (q.includes(table.toLowerCase())) {
          sql = `SELECT COUNT(*) as total FROM "${table}"`;
          break;
        }
      }
    }
    
    // Heurística: listagem
    if (sql === null && /\b(list[aeo]|mostre?|exib[aio]|show|selecione)\b/.test(q)) {
      for (const table of tableNames) {
        if (q.includes(table.toLowerCase())) {
          sql = `SELECT * FROM "${table}"`;
          break;
        }
      }
    }
    
    // Heurística: primeiros N registros
    if (sql === null) {
      const limitMatch = q.match(/\b(\d+)\s*(primeiro|últim|recent|first|last)/i);
      if (limitMatch) {
        for (const table of tableNames) {
          if (q.includes(table.toLowerCase())) {
            sql = `SELECT * FROM "${table}" LIMIT ${limitMatch[1]}`;
            break;
          }
        }
      }
    }
    
    // Se não conseguiu gerar, retorna contexto para a LLM
    if (sql === null) {
      return responseToText({
        content: [
          {
            type: 'text',
            text: 'Não foi possível gerar SQL automaticamente. Use a estrutura abaixo para formular a consulta.',
          },
          {
            type: 'json',
            data: {
              hint: 'Forneça um SQL SELECT válido ou reformule a pergunta incluindo o nome da tabela.',
              availableTables: tableNames,
              schemaDescription: schemaDesc,
            },
          },
        ],
      });
    }
  }
  
  // Valida e prepara a query
  const prepared = prepareQuery(sql, maxRows);
  if (!prepared.valid) {
    return responseToText(formatForbiddenResponse(prepared.error!));
  }
  
  // Executa a query
  const startTime = Date.now();
  try {
    const result = await executeQuery(prepared.sql);
    const executionTimeMs = Date.now() - startTime;
    
    if (result.rows.length === 0) {
      return responseToText(formatEmptyResponse(prepared.sql, executionTimeMs));
    }
    
    // Extrai tipos das colunas
    const columns = result.fields.map(f => ({
      name: f.name,
      type: f.dataTypeID.toString(), // ID do tipo PostgreSQL
    }));
    
    const queryResult: QueryResult = {
      columns,
      rows: result.rows,
      rowCount: result.rows.length,
      sql: prepared.sql,
      executionTimeMs,
    };
    
    return responseToText(formatQueryResponse(queryResult));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    return responseToText(
      formatErrorResponse(`Erro ao executar consulta: ${errorMessage}`, {
        sql: prepared.sql,
        originalError: errorMessage,
      })
    );
  }
}

/**
 * Handler principal da tool alusadb
 */
async function handleAlusaDb(input: AlusaDbInput): Promise<string> {
  // Valida input
  const parsed = AlusaDbInputSchema.safeParse(input);
  if (!parsed.success) {
    return responseToText(
      formatErrorResponse(`Input inválido: ${parsed.error.message}`)
    );
  }
  
  const { question, maxRows, schema } = parsed.data;
  
  // Analisa o tipo de pergunta
  const analysis = analyzeQuestion(question);
  
  switch (analysis.type) {
    case 'forbidden':
      return responseToText(formatForbiddenResponse(analysis.errorMessage!));
    
    case 'structure':
      return await handleStructureQuestion(question, schema);
    
    case 'data':
      return await handleDataQuestion(question, maxRows, schema);
    
    default:
      return responseToText(
        formatErrorResponse('Tipo de pergunta não reconhecido.')
      );
  }
}

/**
 * Inicializa e executa o servidor MCP
 */
async function main(): Promise<void> {
  console.error('[alusadb] Iniciando servidor MCP...');
  
  // Testa conexão com o banco
  const connected = await testConnection();
  if (!connected) {
    console.error('[alusadb] ERRO: Não foi possível conectar ao banco de dados.');
    console.error('[alusadb] Verifique DATABASE_URL ou variáveis PGHOST, PGPORT, etc.');
    process.exit(1);
  }
  console.error('[alusadb] Conexão com banco estabelecida.');
  
  // Carrega schema inicial (pré-aquece cache)
  try {
    await loadDatabaseStructure();
    console.error('[alusadb] Cache de schema inicializado.');
  } catch (error) {
    console.error('[alusadb] Aviso: Falha ao pré-carregar schema:', error);
  }
  
  // Configura schemas permitidos via env (opcional)
  const allowedSchemas = process.env.ALLOWED_SCHEMAS;
  if (allowedSchemas) {
    setAllowedSchemas(allowedSchemas.split(',').map(s => s.trim()));
  }
  
  // Cria servidor MCP
  const server = new Server(
    {
      name: 'alusadb',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );
  
  // Handler: listar tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: [ALUSADB_TOOL] };
  });
  
  // Handler: executar tool
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    
    if (name !== 'alusadb') {
      return {
        content: [
          {
            type: 'text',
            text: `Tool "${name}" não encontrada. Use "alusadb".`,
          },
        ],
        isError: true,
      };
    }
    
    try {
      const result = await handleAlusaDb(args as unknown as AlusaDbInput);
      return {
        content: [{ type: 'text', text: result }],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro interno';
      console.error('[alusadb] Erro:', error);
      return {
        content: [
          {
            type: 'text',
            text: `Erro ao processar pergunta: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  });
  
  // Conecta transporte stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.error('[alusadb] Servidor MCP rodando via stdio.');
  
  // Handlers de encerramento
  process.on('SIGINT', async () => {
    console.error('\n[alusadb] Encerrando...');
    await closePool();
    await server.close();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.error('[alusadb] Encerrando (SIGTERM)...');
    await closePool();
    await server.close();
    process.exit(0);
  });
}

// Executa
main().catch((error) => {
  console.error('[alusadb] Erro fatal:', error);
  process.exit(1);
});

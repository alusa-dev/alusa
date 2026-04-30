# AlusaDB MCP - Documentação Completa

## Índice

1. [Visão Geral](#visão-geral)
2. [Arquitetura](#arquitetura)
3. [Como Foi Criado](#como-foi-criado)
4. [Funcionamento](#funcionamento)
5. [Tools Disponíveis](#tools-disponíveis)
6. [Boas Práticas](#boas-práticas)
7. [Evitando Erros Comuns](#evitando-erros-comuns)
8. [Pontos Importantes para Criar um MCP](#pontos-importantes-para-criar-um-mcp)
9. [Integração no Desenvolvimento da Alusa](#integração-no-desenvolvimento-da-alusa)
10. [Exemplos de Uso](#exemplos-de-uso)

---

## Visão Geral

O **AlusaDB MCP** é um servidor MCP (Model Context Protocol) personalizado que permite que agentes de IA (GitHub Copilot, Claude, etc.) acessem o banco de dados PostgreSQL da Alusa de forma segura e controlada.

### Objetivos

- Permitir introspecção do banco de dados e schema Prisma
- Executar queries SELECT de forma segura (somente leitura)
- Gerar código automaticamente (schemas Zod, services, APIs, forms, tables)
- Acelerar o desenvolvimento fullstack com geração de artefatos padronizados
- Manter segurança e proteção de dados sensíveis

### Benefícios

| Benefício | Descrição |
|-----------|-----------|
| **Produtividade** | Gera código pronto para uso em segundos |
| **Padronização** | Garante consistência entre banco, schema e código |
| **Segurança** | Apenas leitura, mascaramento de dados sensíveis |
| **Onboarding** | Novos devs entendem o domínio rapidamente |
| **Integração IA** | Copilot e agentes podem usar contexto real do banco |

---

## Arquitetura

```
mcp/
├── postgres-server.ts   # Servidor MCP principal (entry point)
├── database.ts          # Pool de conexão PostgreSQL e queries
├── prisma-reader.ts     # Parser do schema Prisma (introspecção semântica)
├── generators.ts        # Geradores de código (Zod, Services, APIs, Forms, Tables)
├── security.ts          # Validação, sanitização e mascaramento
├── types.ts             # Tipos TypeScript compartilhados
├── package.json         # Dependências do MCP
├── tsconfig.json        # Configuração TypeScript
└── README.md            # Documentação básica
```

### Fluxo de Dados

```
┌─────────────┐     stdio      ┌─────────────┐     SQL      ┌─────────────┐
│  VS Code    │ ◄────────────► │  MCP Server │ ◄──────────► │  PostgreSQL │
│  Copilot    │   JSON-RPC     │  (alusadb)  │   pg pool    │   Database  │
└─────────────┘                └─────────────┘              └─────────────┘
                                     │
                                     ▼
                              ┌─────────────┐
                              │   Prisma    │
                              │   Schema    │
                              └─────────────┘
```

---

## Como Foi Criado

### 1. Estrutura Inicial

```bash
# Criar pasta do MCP
mkdir mcp
cd mcp

# Inicializar package.json
npm init -y
```

### 2. Dependências

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.24.3",
    "pg": "^8.16.3",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@types/node": "^22.10.1",
    "@types/pg": "^8.15.6",
    "tsx": "^4.21.0",
    "typescript": "^5.6.3"
  }
}
```

### 3. Configuração TypeScript

```jsonc
// mcp/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": false,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": ".",
    "declaration": true,
    "types": ["node"],
    "typeRoots": ["./node_modules/@types", "../node_modules/@types"]
  },
  "include": ["*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

### 4. Servidor MCP Principal

O servidor é criado usando o SDK oficial do MCP:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({
  name: 'alusadb',
  version: '1.0.0',
}, {
  instructions: `Descrição das capacidades do MCP...`
});

// Registrar tools
server.registerTool('listTables', { ... }, async () => { ... });

// Conectar via stdio
const transport = new StdioServerTransport();
await server.connect(transport);
```

### 5. Configuração no VS Code

```jsonc
// .vscode/mcp.json
{
  "servers": {
    "alusadb": {
      "command": "npx",
      "args": ["dotenv", "-e", ".env", "--", "tsx", "mcp/postgres-server.ts"],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

### 6. Scripts de Execução

```json
// package.json (raiz)
{
  "scripts": {
    "mcp": "dotenv -e .env -- tsx mcp/postgres-server.ts",
    "mcp:build": "tsc -p mcp/tsconfig.json",
    "mcp:dev": "dotenv -e .env -- tsx watch mcp/postgres-server.ts"
  }
}
```

---

## Funcionamento

### Inicialização

1. O VS Code/Copilot inicia o processo via `npx dotenv -e .env -- tsx mcp/postgres-server.ts`
2. O servidor carrega variáveis de ambiente (DATABASE_URL)
3. Inicializa pool de conexão PostgreSQL
4. Parseia o schema Prisma e cacheia models/enums
5. Registra todas as tools disponíveis
6. Aguarda conexões via stdio (JSON-RPC)

### Comunicação

- **Protocolo:** JSON-RPC 2.0 via stdio
- **Transporte:** stdin/stdout
- **Formato:** Mensagens JSON com `method`, `params` e `id`

### Ciclo de Vida

```
┌──────────────┐
│   Startup    │ ─► Carrega .env, conecta PostgreSQL, parseia Prisma
└──────┬───────┘
       ▼
┌──────────────┐
│   Aguarda    │ ─► Servidor pronto, aguardando chamadas de tools
└──────┬───────┘
       ▼
┌──────────────┐
│  Executa     │ ─► Recebe chamada, valida, executa, retorna resultado
└──────┬───────┘
       ▼
┌──────────────┐
│  Shutdown    │ ─► SIGINT/SIGTERM, fecha pool, encerra processo
└──────────────┘
```

---

## Tools Disponíveis

### Introspecção de Banco

| Tool | Descrição | Parâmetros |
|------|-----------|------------|
| `listTables` | Lista todas as tabelas do banco | - |
| `describeTable` | Detalha colunas, PKs, FKs, índices | `table: string` |
| `listRelations` | Lista todas as foreign keys | - |
| `runSelect` | Executa query SELECT segura | `query: string` |

### Introspecção Prisma

| Tool | Descrição | Parâmetros |
|------|-----------|------------|
| `listPrismaModels` | Lista todos os models do schema | - |
| `getPrismaModel` | Detalha um model específico | `name: string` |
| `invalidateSchemaCache` | Força releitura do schema | - |

### Geradores de Código

| Tool | Descrição | Parâmetros |
|------|-----------|------------|
| `generateZodSchemaFromTable` | Gera schema Zod de validação | `table`, `includeRelations?` |
| `generateServiceLayer` | Gera service com CRUD | `table`, `includePagination?`, `includeFilters?` |
| `generateNextApiRoute` | Gera Route Handler Next.js | `table`, `includeAuth?`, `includeValidation?` |
| `generateShadcnForm` | Gera formulário ShadCN UI | `table`, `layout?` |
| `generateTanstackTable` | Gera tabela TanStack | `table`, `includePagination?`, `includeSorting?`, `includeActions?` |

---

## Boas Práticas

### 1. Segurança em Primeiro Lugar

```typescript
// ✅ SEMPRE validar queries
export function validateSelectOnly(query: string): boolean {
  const normalizedQuery = query.trim().toUpperCase();
  
  // Deve começar com SELECT
  if (!normalizedQuery.startsWith('SELECT')) {
    throw new Error('Apenas queries SELECT são permitidas');
  }
  
  // Bloquear palavras-chave perigosas
  const forbidden = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'TRUNCATE', ...];
  for (const keyword of forbidden) {
    if (normalizedQuery.includes(keyword)) {
      throw new Error(`Palavra-chave "${keyword}" não permitida`);
    }
  }
  
  return true;
}
```

### 2. Mascaramento de Dados Sensíveis

```typescript
// ✅ Definir campos sensíveis
const SENSITIVE_COLUMNS = [
  'password', 'senha', 'senhaHash',
  'token', 'secret', 'apiKey',
  'asaasApiKeyEncrypted',
  'creditCardToken',
  // ...
];

// ✅ Mascarar antes de retornar
function maskSensitiveData(result: QueryResult): QueryResult {
  return {
    ...result,
    rows: result.rows.map(row => {
      const masked = { ...row };
      for (const key of Object.keys(masked)) {
        if (isSensitiveColumn(key)) {
          masked[key] = '[DADOS_PROTEGIDOS]';
        }
      }
      return masked;
    })
  };
}
```

### 3. Limites de Resultados

```typescript
// ✅ Aplicar LIMIT automaticamente
export const QUERY_LIMITS = {
  MAX_ROWS: 500,
  DEFAULT_ROWS: 100,
  MAX_QUERY_LENGTH: 5000,
  MAX_EXECUTION_TIME_MS: 30000,
};

function ensureQueryLimit(query: string): string {
  if (!query.toUpperCase().includes('LIMIT')) {
    return `${query} LIMIT ${QUERY_LIMITS.DEFAULT_ROWS}`;
  }
  return query;
}
```

### 4. Pool de Conexão Eficiente

```typescript
// ✅ Configurar pool adequadamente
const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 5,                    // Máximo de conexões
  idleTimeoutMillis: 30000,  // Timeout de conexão ociosa
  connectionTimeoutMillis: 10000,
  statement_timeout: 30000,  // Timeout de query
});

// ✅ SEMPRE liberar conexão após uso
const client = await pool.connect();
try {
  const result = await client.query(query);
  return result;
} finally {
  client.release(); // CRÍTICO!
}
```

### 5. Tipagem Forte

```typescript
// ✅ Definir tipos para tudo
interface TableInfo {
  table_name: string;
  table_schema: string;
  table_type: string;
  row_count?: number;
}

interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  fields: string[];
  executionTime: number;
  truncated: boolean;
}
```

### 6. Logging Seguro

```typescript
// ✅ Nunca logar dados sensíveis
function createSafeLogEntry(params: {
  action: string;
  query?: string;
  error?: Error;
}): SafeLogEntry {
  return {
    timestamp: new Date().toISOString(),
    action: params.action,
    // Sanitiza query antes de logar
    query: params.query ? sanitizeQueryForLog(params.query) : undefined,
    error: params.error?.message,
  };
}

// ✅ Remover valores de queries nos logs
function sanitizeQueryForLog(query: string): string {
  return query
    .replace(/'[^']*'/g, "'***'")  // Remove strings
    .replace(/\b\d{10,}\b/g, '***') // Remove números longos
    .substring(0, 500);
}
```

---

## Evitando Erros Comuns

### ❌ Erro 1: DATABASE_URL não definida

**Problema:** O MCP não carrega variáveis de ambiente automaticamente.

**Solução:** Usar `dotenv-cli` para carregar o `.env`:

```json
{
  "command": "npx",
  "args": ["dotenv", "-e", ".env", "--", "tsx", "mcp/postgres-server.ts"]
}
```

### ❌ Erro 2: Conexão não liberada

**Problema:** Pool esgota se conexões não forem liberadas.

**Solução:** Usar `try/finally` para garantir release:

```typescript
const client = await pool.connect();
try {
  return await client.query(query);
} finally {
  client.release(); // SEMPRE!
}
```

### ❌ Erro 3: SQL Injection

**Problema:** Concatenar valores diretamente na query.

**Solução:** Usar queries parametrizadas:

```typescript
// ❌ ERRADO
await client.query(`SELECT * FROM users WHERE id = '${userId}'`);

// ✅ CORRETO
await client.query('SELECT * FROM users WHERE id = $1', [userId]);
```

### ❌ Erro 4: Schema Prisma desatualizado

**Problema:** Cache do schema não reflete alterações.

**Solução:** Implementar invalidação de cache:

```typescript
server.registerTool('invalidateSchemaCache', {}, async () => {
  invalidateCache();
  const { models, enums } = parsePrismaSchema();
  return `Cache invalidado: ${models.length} models, ${enums.length} enums`;
});
```

### ❌ Erro 5: Timeout em queries longas

**Problema:** Queries complexas travam o servidor.

**Solução:** Definir timeouts:

```typescript
const pool = new Pool({
  statement_timeout: 30000, // 30 segundos
});
```

### ❌ Erro 6: Módulos ESM vs CommonJS

**Problema:** Erro de import/export com módulos.

**Solução:** Configurar `"type": "module"` e usar extensões `.js`:

```typescript
// ✅ Importar com extensão .js (mesmo sendo .ts)
import { initializePool } from './database.js';
```

---

## Pontos Importantes para Criar um MCP

### 1. Planejamento

- [ ] Definir escopo e propósito do MCP
- [ ] Listar tools necessárias
- [ ] Mapear integrações externas (banco, APIs, arquivos)
- [ ] Definir requisitos de segurança

### 2. Estrutura de Arquivos

```
meu-mcp/
├── server.ts          # Entry point
├── tools/             # Uma pasta por domínio de tools
│   ├── database.ts
│   ├── generators.ts
│   └── analytics.ts
├── lib/               # Utilitários compartilhados
│   ├── security.ts
│   ├── cache.ts
│   └── types.ts
├── package.json
├── tsconfig.json
└── README.md
```

### 3. Checklist de Implementação

- [ ] Configurar TypeScript com ESM
- [ ] Instalar SDK MCP e dependências
- [ ] Criar servidor com nome e versão
- [ ] Implementar tools com schemas Zod
- [ ] Adicionar validação de entrada
- [ ] Implementar tratamento de erros
- [ ] Adicionar logging seguro
- [ ] Configurar graceful shutdown
- [ ] Escrever documentação
- [ ] Testar todas as tools

### 4. Registro de Tools

```typescript
server.registerTool(
  'nomeDaTool',           // Nome único
  {
    title: 'Título',      // Título legível
    description: '...',   // Descrição detalhada
    inputSchema: {        // Schema Zod para validação
      param1: z.string().describe('Descrição do parâmetro'),
      param2: z.boolean().optional(),
    },
  },
  async ({ param1, param2 }) => {
    // Implementação
    return createSuccessResponse(resultado);
  }
);
```

### 5. Tratamento de Erros

```typescript
async function handleToolCall(fn: () => Promise<unknown>) {
  try {
    const result = await fn();
    return createSuccessResponse(result);
  } catch (error) {
    console.error('[MCP] Erro:', error);
    return createErrorResponse(error as Error);
  }
}
```

### 6. Configuração do Cliente (VS Code)

```jsonc
// .vscode/mcp.json
{
  "servers": {
    "meu-mcp": {
      "command": "npx",
      "args": ["tsx", "caminho/para/server.ts"],
      "cwd": "${workspaceFolder}",
      "env": {
        "VARIAVEL": "valor"
      }
    }
  }
}
```

---

## Integração no Desenvolvimento da Alusa

### Fluxo de Trabalho Recomendado

#### 1. Criar Nova Feature

```
1. Consultar estrutura: #alusadb describeTable { "table": "MinhaTabela" }
2. Gerar schema:       #alusadb generateZodSchemaFromTable { "table": "MinhaTabela" }
3. Gerar service:      #alusadb generateServiceLayer { "table": "MinhaTabela" }
4. Gerar endpoint:     #alusadb generateNextApiRoute { "table": "MinhaTabela" }
5. Gerar formulário:   #alusadb generateShadcnForm { "table": "MinhaTabela" }
6. Gerar tabela:       #alusadb generateTanstackTable { "table": "MinhaTabela" }
```

#### 2. Debugging e Análise

```
# Verificar dados
#alusadb runSelect { "query": "SELECT * FROM Aluno LIMIT 5" }

# Verificar relações
#alusadb listRelations

# Verificar estrutura
#alusadb getPrismaModel { "name": "Matricula" }
```

#### 3. Onboarding de Novos Devs

```
# Entender o domínio
#alusadb listTables
#alusadb listPrismaModels

# Explorar tabelas principais
#alusadb describeTable { "table": "Aluno" }
#alusadb describeTable { "table": "Matricula" }
#alusadb describeTable { "table": "Cobranca" }
```

### Integração com CI/CD

```yaml
# .github/workflows/validate-schema.yml
name: Validate Schema
on: [push]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install
      - run: pnpm mcp:build  # Valida TypeScript do MCP
```

### Convenções da Alusa

1. **Nomenclatura:** Use `#alusadb` para invocar tools no chat
2. **Geração de código:** Sempre revisar código gerado antes de usar
3. **Queries:** Preferir queries simples e específicas
4. **Cache:** Usar `invalidateSchemaCache` após alterar schema Prisma
5. **Segurança:** Nunca compartilhar outputs com dados sensíveis

---

## Exemplos de Uso

### Exemplo 1: Listar todas as tabelas

```
#alusadb listTables
```

**Resultado:**
```
📊 Tabelas do Banco de Dados (31 tabelas)

| Tabela | Schema | Tipo | Linhas (aprox) |
|--------|--------|------|----------------|
| Aluno  | public | BASE TABLE | 8 |
| Matricula | public | BASE TABLE | 12 |
...
```

### Exemplo 2: Descrever tabela

```
#alusadb describeTable { "table": "Aluno" }
```

**Resultado:**
```
📋 Tabela: Aluno
📈 Linhas: ~8
🔑 Primary Key: id

### Colunas
| Nome | Tipo | Nullable | Default | PK | FK |
|------|------|----------|---------|----|----|
| id | text | NO | cuid() | ✓ | |
| nome | text | NO | - | | |
| email | text | YES | - | | |
...
```

### Exemplo 3: Executar query

```
#alusadb runSelect { "query": "SELECT nome, email FROM Aluno WHERE status = 'ATIVO'" }
```

**Resultado:**
```
✅ Query executada com sucesso
⏱️ Tempo: 45ms
📊 Linhas: 8

[
  { "nome": "Bryan", "email": "bry***@***.com" },
  ...
]
```

### Exemplo 4: Gerar schema Zod

```
#alusadb generateZodSchemaFromTable { "table": "Turma" }
```

**Resultado:**
```typescript
import { z } from 'zod';

export const turmaSchema = z.object({
  id: z.string(),
  nome: z.string(),
  modalidadeId: z.string(),
  salaId: z.string(),
  // ...
});

export const turmaCreateSchema = turmaSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
```

### Exemplo 5: Gerar service layer

```
#alusadb generateServiceLayer { "table": "Cobranca", "includePagination": true }
```

**Resultado:**
```typescript
import { prisma } from '@/lib/prisma';

export const cobrancaService = {
  async findById(id: string) { ... },
  async findMany(filters, pagination) { ... },
  async create(data) { ... },
  async update(id, data) { ... },
  async delete(id) { ... },
};
```

---

## Referências

- [Model Context Protocol - Documentação Oficial](https://modelcontextprotocol.io/)
- [MCP SDK - GitHub](https://github.com/modelcontextprotocol/sdk)
- [Prisma - Documentação](https://www.prisma.io/docs)
- [Node-Postgres - Documentação](https://node-postgres.com/)
- [Zod - Documentação](https://zod.dev/)

---

## Changelog

### v1.0.0 (2025-12-04)

- ✅ Implementação inicial do AlusaDB MCP
- ✅ Tools de introspecção de banco (listTables, describeTable, listRelations, runSelect)
- ✅ Tools de introspecção Prisma (listPrismaModels, getPrismaModel, invalidateSchemaCache)
- ✅ Geradores de código (Zod, Service, API, Form, Table)
- ✅ Segurança: mascaramento, validação, limites
- ✅ Integração com VS Code e Copilot

---

*Documentação gerada em 04/12/2025 - Alusa Team*

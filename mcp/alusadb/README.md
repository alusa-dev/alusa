# MCP alusadb

Servidor MCP (Model Context Protocol) para consulta segura a banco PostgreSQL.

## Recursos

- **Descoberta de Schema**: Lista schemas, tabelas, colunas, tipos e relacionamentos
- **Consultas Seguras**: Apenas SELECT e CTEs (WITH) são permitidos
- **Guardrails**: Bloqueia DELETE, UPDATE, INSERT, DROP e outras operações destrutivas
- **Cache Inteligente**: Cache de schema com TTL configurável (60s padrão)
- **Timeout**: Proteção contra queries longas (10s padrão)
- **Limite de Linhas**: Máximo de 1000 linhas por consulta

## Instalação

```bash
# Na raiz do projeto
pnpm install

# Ou instalar dependências específicas
cd mcp/alusadb && pnpm install
```

## Configuração

### Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto (ou use o existente):

```env
# Opção 1: URL de conexão (recomendado)
DATABASE_URL=

# Opção 2: Variáveis separadas
# PGHOST=localhost
# PGPORT=5432
# PGDATABASE=alusa_dev
# PGUSER=usuario
# PGPASSWORD=senha

# Opcional: limitar schemas permitidos
# ALLOWED_SCHEMAS=public,app
```

### VS Code Copilot

O servidor já está configurado no `mcp.config.json` da raiz do projeto:

```json
{
  "mcpServers": {
    "alusadb": {
      "command": "npx",
      "args": [
        "dotenv",
        "-e",
        ".env",
        "--",
        "tsx",
        "mcp/alusadb/src/index.ts"
      ],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

Para registrar manualmente via comando:

```bash
code --add-mcp '{"name":"alusadb","command":"npx","args":["dotenv","-e",".env","--","tsx","mcp/alusadb/src/index.ts"]}'
```

## Uso

### Scripts npm

```bash
# Rodar em modo desenvolvimento (com watch)
pnpm mcp:alusadb:dev

# Rodar em produção
pnpm mcp:alusadb

# Build (gera dist/)
pnpm mcp:build
```

### Exemplos de Perguntas

#### 1. Estrutura do Banco

**Pergunta:** "Quais tabelas existem no banco?"

**Comportamento:** Retorna lista de schemas, tabelas e colunas.

```json
{
  "content": [
    { "type": "text", "text": "Estrutura do banco PostgreSQL detectada: 1 schema(s), 15 tabela(s)..." },
    { "type": "json", "data": { "schemas": [...] } }
  ]
}
```

#### 2. Detalhes de uma Tabela

**Pergunta:** "Descreva a estrutura da tabela usuarios"

**SQL esperado:** Nenhum (usa introspecção)

**Retorno:** Colunas, tipos, PKs, FKs da tabela.

#### 3. Contagem de Registros

**Pergunta:** "Quantos alunos existem no sistema?"

**SQL esperado:**
```sql
SELECT COUNT(*) as total FROM "Aluno" LIMIT 100
```

#### 4. Listagem Simples

**Pergunta:** "Liste as 10 primeiras turmas"

**SQL esperado:**
```sql
SELECT * FROM "Turma" LIMIT 10
```

#### 5. Consulta Analítica

**Pergunta:** "Liste os clientes com mais de 10 pedidos"

**SQL esperado:**
```sql
SELECT c.nome, COUNT(p.id) AS total_pedidos 
FROM clientes c 
JOIN pedidos p ON p.cliente_id = c.id 
GROUP BY c.nome 
HAVING COUNT(p.id) > 10 
LIMIT 100
```

### Operações Bloqueadas

**Pergunta:** "Delete todos os registros antigos"

**Resposta:**
```json
{
  "content": [
    { "type": "error", "text": "Operação não permitida. Este MCP opera apenas em modo leitura (SELECT)." }
  ]
}
```

## Arquitetura

```
mcp/alusadb/
├── src/
│   ├── index.ts        # Server MCP + registro de tools
│   ├── db.ts           # Pool PostgreSQL
│   ├── introspection.ts # Leitura de metadados do banco
│   ├── security.ts     # Guardrails SQL
│   ├── format.ts       # Formatador de respostas MCP
│   └── types.ts        # Tipos TypeScript
├── package.json
├── tsconfig.json
└── .env.example
```

## Segurança

### Checklist

- [x] **Apenas SELECT**: Bloqueio de DELETE, UPDATE, INSERT, DROP, ALTER, TRUNCATE
- [x] **LIMIT forçado**: Máximo 1000 linhas por consulta
- [x] **Timeout**: 10 segundos por query
- [x] **Schema allowlist**: Opcional via `ALLOWED_SCHEMAS`
- [x] **Sanitização**: Remoção de comentários SQL e caracteres perigosos
- [x] **Validação**: Schema Zod para inputs

### Performance

- [x] **Cache de schema**: TTL de 60 segundos
- [x] **Pool de conexões**: Máximo 5 conexões
- [x] **Contagem aproximada**: Usa pg_class para evitar COUNT(*) pesado
- [x] **Idle timeout**: Conexões liberadas após 30s de inatividade

## Formato de Resposta MCP

O servidor retorna respostas no formato padrão MCP:

```typescript
{
  content: [
    { type: "text", text: "Mensagem explicativa" },
    { type: "json", data: { /* dados estruturados */ } },
    { type: "meta", data: { sql: "...", executionTimeMs: 42 } },
    { type: "error", text: "Mensagem de erro" }  // quando aplicável
  ]
}
```

## Troubleshooting

### Erro de conexão

```
[alusadb] ERRO: Não foi possível conectar ao banco de dados.
```

**Solução:** Verifique se `DATABASE_URL` está configurado corretamente no `.env`.

### Query timeout

```
Erro ao executar consulta: canceling statement due to statement timeout
```

**Solução:** A query excedeu 10 segundos. Otimize a consulta ou adicione índices.

### Tabela não encontrada

```
Tabela "usuarios" não encontrada no banco.
```

**Solução:** Verifique o nome exato da tabela (case-sensitive no PostgreSQL).

## Licença

MIT © Alusa

# Alusa — Guia de Isolamento Multitenant

Este documento descreve a arquitetura de isolamento de dados entre contas (tenants)
no sistema Alusa, e como usar corretamente os utilitários de tenant em novos desenvolvimentos.

## Arquitetura de Isolamento

O Alusa utiliza a estratégia **Shared Database, Shared Schema** com isolamento por coluna `contaId`.
Para garantir que nenhum dado de um cliente seja acessível por outro, implementamos **4 camadas de defesa**:

```
┌─────────────────────────────────────────────────────────┐
│  Camada 4: Auditoria (scripts/audit-tenant-orphans.ts)  │
│  Detecção periódica de dados cruzados no banco          │
├─────────────────────────────────────────────────────────┤
│  Camada 3: ESLint (eslint-plugin-tenant-safety.mjs)     │
│  Aviso em tempo de desenvolvimento sobre queries sem    │
│  contaId no where                                       │
├─────────────────────────────────────────────────────────┤
│  Camada 2: RLS PostgreSQL (scripts/setup-rls.ts)        │
│  Filtro automático no banco via SET app.current_tenant  │
├─────────────────────────────────────────────────────────┤
│  Camada 1: Prisma Extension (lib/prisma-tenant.ts)      │
│  Injeção automática de contaId em todas as queries ORM  │
└─────────────────────────────────────────────────────────┘
```

## Uso Rápido

### ✅ Forma Correta (recomendada)

```typescript
import { createTenantPrismaFromSession } from '@/lib/tenant';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

export async function GET() {
  const session = await getServerSession(authOptions);
  const db = createTenantPrismaFromSession(session); // ← lança erro se sessão inválida

  // contaId é injetado automaticamente em TODAS as queries abaixo!
  const alunos = await db.aluno.findMany();
  const turmas = await db.turma.count({ where: { status: 'ATIVO' } });
  const cobrancas = await db.cobranca.findMany({ where: { status: 'PENDENTE' } });

  return Response.json({ alunos, turmas, cobrancas });
}
```

### ✅ Alternativa com contaId manual

```typescript
import { createTenantPrismaClient } from '@/lib/tenant';

const db = createTenantPrismaClient(contaId);
const alunos = await db.aluno.findMany(); // contaId injetado automaticamente
```

### ❌ Forma a Evitar (risco de cross-tenant)

```typescript
import prisma from '@/lib/prisma';

// SEM o createTenantPrismaClient, VOCÊ É RESPONSÁVEL por filtrar
const alunos = await prisma.aluno.findMany(); // ⚠️ RETORNA ALUNOS DE TODAS AS CONTAS!
```

## Modelos Tenant-Aware

Os seguintes modelos do Prisma possuem `contaId` direto e são interceptados
automaticamente pela Prisma Extension:

| Modelo | Filtro automático |
|--------|-------------------|
| Aluno | ✅ |
| Colaborador | ✅ |
| Professor | ✅ |
| Turma | ✅ |
| Modalidade | ✅ |
| Sala | ✅ |
| Plano | ✅ |
| Combo | ✅ |
| Desconto | ✅ |
| Matricula | ✅ |
| Cobranca | ✅ |
| Lancamento | ✅ |
| CentroCusto | ✅ |
| CategoriaLancamento | ✅ |
| CalendarEvent | ✅ |
| AttendanceRecord | ✅ |
| MakeupClass | ✅ |
| AulasOperationLog | ✅ |
| PortalEvento | ✅ |
| ContratoTemplate | ✅ |
| ContratoModelo | ✅ |
| Notification | ✅ |
| AuditLog | ✅ |
| Customer | ✅ |
| Charge | ✅ |
| ChargeReadModel | ✅ |
| Subscription | ✅ |
| InstallmentPlan | ✅ |
| TransferRequest | ✅ |
| ProductCategory | ✅ |
| Product | ✅ |
| Sale | ✅ |

> ℹ️ Modelos sem `contaId` direto (ex: `Pagamento`, `TurmaProfessor`) são acessados
> via joins/includes e a filtragem é garantida pelo modelo pai tenant-aware.

## Scripts de Manutenção

```bash
# Auditar integridade dos dados de tenant no banco
pnpm --filter @alusa/web tenant:audit

# Auditoria com output JSON (útil para CI/CD)
pnpm --filter @alusa/web tenant:audit:json

# Ver quais SQLs o setup de RLS geraria (sem executar)
pnpm --filter @alusa/web db:setup-rls:dry

# Habilitar RLS no banco de dados (executar em produção)
pnpm --filter @alusa/web db:setup-rls
```

## Adicionando um Novo Modelo Tenant-Aware

Quando adicionar um novo modelo com `contaId` ao `schema.prisma`:

1. **Adicionar à lista no Prisma Extension:**
   ```typescript
   // apps/web/lib/prisma-tenant.ts
   export const TENANT_AWARE_MODELS = [
     ...
     'meuNovoModelo', // ← adicionar aqui em camelCase
   ] as const;
   ```

2. **Adicionar ao script de RLS:**
   ```typescript
   // apps/web/scripts/setup-rls.ts
   const TENANT_TABLES: Record<string, string> = {
     ...
     MeuNovoModelo: 'MeuNovoModelo', // ← adicionar aqui
   };
   ```

3. **Adicionar ao script de auditoria:**
   ```typescript
   // apps/web/scripts/audit-tenant-orphans.ts
   // Adicionar uma verificação ao final
   ```

4. **Reexecutar o setup de RLS** se o ambiente de produção usa o RLS habilitado.

## Modelos Globais (não tenant-aware)

Os seguintes modelos são **intencionalmente globais** e não usam contaId:
- `Conta` — O próprio modelo de tenant
- `Usuario` — Gerenciado pelo modelo `UsuarioConta` (N:N)
- `Invite` — Convites de usuário (escopo de conta via contaId em campo próprio)
- `AuthActionToken` — Tokens de autenticação globais
- `AsaasAccount`, `KycProcess`, `KycRequirement`, `KycSlot` — Gerenciados pelo módulo Asaas

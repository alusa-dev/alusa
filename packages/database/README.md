# @alusa/database

Camada de acesso a dados com Prisma Client e repositories.

## Responsabilidades

- ✅ Singleton do Prisma Client
- ✅ Repositories para acesso tipado ao banco
- ✅ Helpers de queries complexas
- ✅ Gestão de credenciais encriptadas
- ✅ Transações e operações atômicas

## Princípios

- **Repository Pattern** para isolar Prisma
- **Tipagem forte** com tipos gerados do Prisma
- **Transações explícitas** quando necessário
- **Descriptografia segura** de credenciais

## Uso

```typescript
import { prisma, loadAsaasCredentials, isAsaasEnabled } from '@alusa/database';

// Verificar se Asaas está habilitado
const enabled = await isAsaasEnabled(contaId);

// Carregar credenciais
const creds = await loadAsaasCredentials(contaId);
if (creds) {
  // usar creds.apiKey e creds.webhookSecret
}

// Acesso direto ao Prisma (quando necessário)
const alunos = await prisma.aluno.findMany({ where: { contaId } });
```

# Rotas dinâmicas no Next.js 15 (App Router)

## Sintoma

- URL com ID válido (ex.: `/financeiro/pagamentos/cmovog8xg00069dx34upujt5d`)
- API ou tela responde **"ID do aluno é obrigatório"** (ou 400 equivalente)
- Testes unitários da rota passam com `{ params: { id: '...' } }`

## Causa

A partir do Next.js 15, em `page.tsx` e `route.ts` dentro de segmentos dinâmicos (`[id]`, `[alunoId]`, etc.), **`params` é uma `Promise`**. Se o código faz `schema.safeParse(params)` ou `params.alunoId` sem `await`, o objeto não contém os campos esperados.

## Correção mínima

### API (`route.ts`)

```ts
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ alunoId: string }> },
) {
  const rawParams = await params;
  const parsed = financeiroPagamentoAlunoParamsDTOSchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { message: 'ID do aluno é obrigatório' } },
      { status: 400 },
    );
  }
  const { alunoId } = parsed.data;
  // ...
}
```

### Página com client (`'use client'`)

1. `page.tsx` (server, async): `const { alunoId } = await params`
2. Componente client recebe `alunoId: string` como prop (não `params`)

Exemplo em produção: `app/(app)/financeiro/pagamentos/[alunoId]/`.

### Página só server

```tsx
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Feature id={id} />;
}
```

### Testes

```ts
const res = await GET(req, { params: Promise.resolve({ alunoId: 'aluno-1' }) });
```

## Respostas esperadas após o fix

| Situação | Resultado |
|----------|-----------|
| ID na URL, aluno existe no tenant | 200 / tela carrega |
| ID vazio ou inválido no schema | 400, mensagem de validação |
| ID válido mas aluno de outro `contaId` | 404, "Aluno não encontrado" |

## Auditoria no monorepo

Buscar padrões legados:

```bash
rg '\{ params \}: \{ params: \{' apps/web/app
rg "params\.(id|alunoId|contaId|token)" apps/web/app --glob '*.ts'
```

Migrar para `Promise<...>` + `await` antes de Zod, Prisma ou fetch.

## Cursor / agentes

Regra automática ao editar rotas dinâmicas: `.cursor/rules/nextjs-15-dynamic-route-params.mdc`.

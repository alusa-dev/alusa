# Plano — Página Nota Fiscal (Financeiro)

**Status:** implementado · Ver [fiscal-nfse-feature.md](../fiscal-nfse-feature.md) §5.3

---

## 1. Objetivo de produto

Dar ao time financeiro da escola uma visão **consolidada por pessoa** das NFS-e já registradas na Alusa, sem depender de abrir cobrança a cobrança.

| Tela | Referência UX | Comportamento |
| --- | --- | --- |
| Índice | [ContratosFeature](../../apps/web/features/contratos/ContratosFeature.tsx) + [Pagamentos](../../apps/web/app/(app)/financeiro/pagamentos/page.tsx) | Lista alunos e responsáveis **somente com ≥1 nota**; busca, filtro de status, paginação |
| Detalhe aluno | [AssinaturaDetalheClient](../../apps/web/app/(app)/cobrancas/assinaturas/[id]/AssinaturaDetalheClient.tsx) | Voltar, KPIs, dados da pessoa, tabela de notas |
| Detalhe responsável | Idem | + coluna **Aluno** quando `matriculaId` existir |

**Fora de escopo (v1):**

- Emitir, cancelar ou sincronizar nota nesta tela (permanecem em `CobrancaNotaFiscal` + `/api/cobrancas/[id]/nota-fiscal/*`).
- Configuração fiscal (permanece em `/admin/configuracoes/notafiscal`).
- Listagem flat global (`GET /api/finance/invoices`) — útil para jobs/admin, não para esta UX.

---

## 2. Contexto Asaas (doc oficial)

Consultado via MCP Asaas ([Overview](https://docs.asaas.com/docs/invoices-overview), [Emitindo NFS-e](https://docs.asaas.com/docs/emitindo-notas-fiscais-de-servico), OpenAPI `GET /v3/invoices`).

### 2.1 Status canônicos

Alinhados ao mapper local [`invoice-status.mapper.ts`](../../packages/finance/src/mappers/invoice-status.mapper.ts):

| Status Asaas | Label UI (já em `CobrancaNotaFiscal`) |
| --- | --- |
| `SCHEDULED` | Agendada |
| `SYNCHRONIZED` | Enviada à prefeitura |
| `AUTHORIZED` | Emitida |
| `PROCESSING_CANCELLATION` | Cancelamento em processamento |
| `CANCELED` | Cancelada |
| `CANCELLATION_DENIED` | Cancelamento negado |
| `ERROR` | Erro na emissão |

Atualizações chegam via webhooks `INVOICE_*` — a tela Financeiro **lê espelho local** (`Invoice`), não consulta Asaas em tempo real.

### 2.2 Origens de nota (impacto na UX, não na listagem)

| Origem | Caminho técnico | Implicação na página |
| --- | --- | --- |
| Cobrança avulsa / parcela / evento | Alusa agenda via `POST /v3/invoices` (`payment`) | Nota criada localmente antes ou junto do espelho |
| Assinatura com `invoiceSettings` | Asaas emite nativamente; Alusa espelha webhook | Pode existir `Invoice` sem ação manual na cobrança |
| Manual | Usuário emite na cobrança | Mesmo modelo `Invoice` |

Ver ADR: evitar dupla emissão (`SUBSCRIPTION_NATIVE_EMISSION`) — a página **não** oferece nova emissão.

### 2.3 Campos úteis para exibição (já persistidos)

Do modelo `Invoice` + resposta Asaas: `number`, `value`, `effectiveDate`, `serviceDescription`, `pdfUrl`, `xmlUrl`, `status`, `statusDescription`, `errorMessage`, vínculo `cobrancaId` / `chargeId`.

Filtros Asaas (`GET /v3/invoices`: `status`, `effectiveDate[Ge/Le]`, `payment`, `customer`) **não** devem ser replicados na v1 — filtros locais em Prisma são suficientes e preservam isolamento `contaId`.

---

## 3. O que já existe (reutilizar)

| Peça | Local |
| --- | --- |
| Modelo `Invoice` | `prisma/schema.prisma` |
| Listagem flat | `packages/finance/src/use-cases/list-invoices.ts` → `GET /api/finance/invoices` |
| Painel por cobrança | `CobrancaNotaFiscal.tsx` + `/api/cobrancas/[id]/nota-fiscal/*` |
| Status / labels / badges | `CobrancaNotaFiscal` (`STATUS_LABELS`, `STATUS_BADGE_VARIANT`) |
| Readiness | `computeFiscalReadiness` — callout se config incompleta |
| Índice financeiro por pessoa (padrão API) | `GET /api/financeiro/pagamentos/summary` + DTOs em `features/financeiro/dtos` |
| Gate financeiro | `guardFinancialAccountOr412` (usar nas novas rotas se cobranças financeiras exigirem) |
| Roles | `ADMIN`, `FINANCEIRO` (mesmo de pagamentos) |

---

## 4. Arquitetura proposta

```
apps/web/
  app/(app)/financeiro/nota-fiscal/
    page.tsx                          # shell → NotaFiscalIndexFeature
    aluno/[alunoId]/page.tsx          # → NotaFiscalPessoaDetalheClient personType=ALUNO
    responsavel/[responsavelId]/page.tsx
  app/api/financeiro/nota-fiscal/
    summary/route.ts
    aluno/[alunoId]/route.ts
    responsavel/[responsavelId]/route.ts
  features/financeiro/notafiscal/
    NotaFiscalIndexFeature.tsx
    NotaFiscalPessoaDetalheClient.tsx
    components/PessoaNotaFiscalCard.tsx
    components/NotaFiscalTable.tsx
    components/NotaFiscalStatusFilters.tsx
    hooks/use-nota-fiscal-index.ts
    hooks/use-nota-fiscal-pessoa.ts
    dtos/index.ts
    mappers/index.ts

packages/finance/src/use-cases/
  list-fiscal-invoice-person-index.ts
  get-fiscal-invoices-by-aluno.ts
  get-fiscal-invoices-by-responsavel.ts
```

**Princípio:** regras de agrupamento, KPIs e filtros em `packages/finance`; route handlers finos; UI só orquestra.

---

## 5. Regras de agrupamento por pessoa

Entrada: tabela `Invoice` filtrada por `contaId`.

| Bucket índice | Condição | Chave |
| --- | --- | --- |
| Aluno | `matriculaId IS NOT NULL` | `matricula.alunoId` |
| Responsável | `matriculaId IS NULL AND responsavelId IS NOT NULL` | `responsavelId` |
| Outros (v1.1 opcional) | ambos null | bucket fixo `OUTROS` |

**Nota:** cobranças de menor via responsável podem gravar `matriculaId` + `responsavelId`; no índice de **aluno** entram pelo aluno; no de **responsável** entram por `responsavelId` — mesma nota pode aparecer nos dois contextos (aceitável se rotular origem na tabela).

### KPIs por pessoa (detalhe)

- `totalNotas` — count
- `totalEmitidas` — status `AUTHORIZED`
- `totalValor` — sum `value` where `AUTHORIZED`
- `ultimaNotaEm` — max `effectiveDate` ou `statusUpdatedAt`
- `comErro` — count `ERROR` + `CANCELLATION_DENIED`
- `pendentes` — `SCHEDULED`, `SYNCHRONIZED`, `PROCESSING_CANCELLATION`

Reutilizar estilo KPI roxo do dashboard/assinatura (`alusa-dashboard-kpi-tile` ou classes equivalentes já usadas em `AssinaturaDetalheClient`).

---

## 6. APIs

### 6.1 `GET /api/financeiro/nota-fiscal/summary`

**Query:** `q`, `status` (multi ou único), `page`, `pageSize` (max 50)

**Resposta:**

```ts
{
  data: Array<{
    id: string;
    tipo: 'ALUNO' | 'RESPONSAVEL';
    nome: string;
    cpfMasked: string | null;
    avatarUrl: string | null;
    totalNotas: number;
    notasEmitidas: number;
    valorTotalEmitido: number;
    ultimaNotaEm: string | null;
    statusDestaque: InvoiceStatus | null; // ex.: ERROR se houver erro recente
  }>;
  total, page, pageSize, totalPages;
  readiness: { ready: boolean; issues: Array<{ code: string; message: string }> };
}
```

**Implementação:** `listFiscalInvoicePersonIndex` — **agregação SQL/Prisma**, não iterar todos os alunos (anti-padrão de `listPersonPaymentLedgerIndex`).

Sugestão de query (conceitual):

1. Subquery/agregação em `Invoice` GROUP BY persona derivada.
2. JOIN `Aluno` / `Responsavel` para nome, CPF, foto.
3. Filtro `HAVING COUNT(*) >= 1`.
4. Ordenação: `ultimaNotaEm DESC`, depois nome.

Índices existentes: `@@index([contaId])`, `@@index([contaId, status])` — avaliar índice composto `(contaId, matriculaId)` / `(contaId, responsavelId)` se explain plan exigir (fase 2 perf).

### 6.2 `GET /api/financeiro/nota-fiscal/aluno/[alunoId]`

**Resposta:**

```ts
{
  pessoa: { id, nome, cpfMasked, avatarUrl, turma?, responsavelPrincipal? };
  kpis: { ... };
  notas: Array<{
    id, number, status, value, effectiveDate,
    serviceDescription, pdfUrl, xmlUrl,
    cobrancaId, cobrancaNumero?, cobrancaHref,
    alunoNome?, // null nesta rota
    errorMessage?, statusDescription?
  }>;
}
```

### 6.3 `GET /api/financeiro/nota-fiscal/responsavel/[responsavelId]`

Igual ao aluno, com `alunoNome` / `alunoId` quando `matriculaId` presente.

**Segurança:** validar `contaId` da sessão; aluno/responsável pertencem à conta; Zod nos DTOs; roles `ADMIN` | `FINANCEIRO`.

---

## 7. UI — fases de entrega

### Fase 1 — Navegação e índice (MVP)

1. Item sidebar em Financeiro: **Nota Fiscal** → `/financeiro/nota-fiscal` ([`sidebar-config.tsx`](../../apps/web/components/layout/sidebar-config.tsx)).
2. `NotaFiscalIndexFeature`:
   - `TableLayout` + busca + filtro status (reutilizar opções de `STATUS_LABELS`).
   - Cards `PessoaNotaFiscalCard` (espelhar `AlunoContratoCard`: avatar, nome, totais, última data).
   - Empty state: “Nenhuma nota fiscal registrada”.
   - **Callout readiness** (variant brand/warning) com link para `/admin/configuracoes/notafiscal` quando `!readiness.ready` — tom Alusa, sem citar Asaas.
3. Paginação client/server como Pagamentos.

### Fase 2 — Detalhe por pessoa

1. `NotaFiscalPessoaDetalheClient`:
   - Botão voltar → índice.
   - Faixa KPI (4–5 tiles).
   - Card “Dados” (nome, CPF, turma/alunos vinculados se responsável).
   - `NotaFiscalTable`: número, data, valor, status (badge compartilhado), serviço (truncado), ações PDF/XML (links externos), link cobrança.
2. Ações de linha: **Ver cobrança** (`/cobrancas/[id]`); PDF/XML abrem em nova aba se URL presente; se `syncPending`, badge discreto “Atualizando” (opcional v1.1, reutilizar lógica `isInvoiceProviderSyncPending`).

### Fase 3 — Polimento

1. Extrair `InvoiceStatusBadge` compartilhado de `CobrancaNotaFiscal` + página Financeiro.
2. Bucket “Outros” se houver notas sem pessoa.
3. Filtro por período (`effectiveDate` mês/intervalo) — alinhado a filtros Asaas mas local.
4. Skeletons alinhados a Contratos/Pagamentos.

---

## 8. Performance e anti-padrões

| Fazer | Evitar |
| --- | --- |
| Agregar em SQL a partir de `Invoice` | Carregar todos alunos/responsáveis e filtrar em memória (pagamentos ledger) |
| Paginar no banco | Buscar todas notas e agrupar no Node |
| Select enxuto + joins necessários | Incluir `taxes` Json na listagem |
| `cache-control: no-store` nas APIs | SWR agressivo em dados fiscais |

Meta inicial: índice < 300 ms em conta com ~2k notas (validar com seed).

---

## 9. Testes

### Unitários (`packages/finance`)

- `listFiscalInvoicePersonIndex`: isolamento `contaId`, busca por nome, filtro status, paginação, exclusão de pessoas sem nota.
- `getFiscalInvoicesByAluno` / `ByResponsavel`: KPIs corretos, ordenação por data, 404 cross-tenant.

### API (`apps/web`)

- Rotas summary/aluno/responsavel: 401, 403, 404, happy path com Zod.

### E2E (opcional v1)

- Login financeiro → índice vazio / com seed → drill-down → link cobrança.

Rodar junto com suíte fiscal existente: `pnpm --filter @alusa/finance test`, testes de `configuracoes/notafiscal`.

---

## 10. Checklist de implementação

```
[ ] packages/finance: listFiscalInvoicePersonIndex + testes
[ ] packages/finance: getFiscalInvoicesByAluno + getFiscalInvoicesByResponsavel + testes
[ ] apps/web: DTOs Zod + mappers
[ ] apps/web: 3 route handlers
[ ] apps/web: NotaFiscalIndexFeature + hooks
[ ] apps/web: NotaFiscalPessoaDetalheClient + NotaFiscalTable
[ ] apps/web: sidebar + page shells
[ ] Refactor opcional: InvoiceStatusBadge compartilhado
[ ] Atualizar fiscal-nfse-feature.md § "Telas" com link para esta rota
[ ] QA manual: readiness callout, PDF/XML, responsável com coluna aluno, tenant isolation
```

---

## 11. Riscos e mitigação

| Risco | Mitigação |
| --- | --- |
| Notas de assinatura sem `matriculaId`/`responsavelId` preenchidos | Backfill job ou bucket Outros; validar webhook handler persiste contexto |
| Duplicata aluno + responsável no índice | Copy claro na UI; documentar regra de bucket |
| URLs PDF/XML expiradas | Link cobrança + botão sincronizar permanece na cobrança |
| Config fiscal incompleta | Callout no índice, não bloquear consulta de notas já emitidas |

---

## 12. Referências

- [fiscal-nfse-feature.md](../fiscal-nfse-feature.md)
- [adr-fiscal-emission-paths.md](../adr-fiscal-emission-paths.md)
- [Asaas — Overview invoices](https://docs.asaas.com/docs/invoices-overview)
- [Asaas — Emitindo NFS-e](https://docs.asaas.com/docs/emitindo-notas-fiscais-de-servico)
- [Asaas — GET /v3/invoices](https://docs.asaas.com/reference/listar-notas-fiscais)
- [Asaas — Webhook notas fiscais](https://docs.asaas.com/docs/webhook-para-notas-fiscais)

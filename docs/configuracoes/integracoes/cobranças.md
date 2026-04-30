# Integração Alusa × Asaas — Cobranças (Mensalidades + Taxas)

> Este documento descreve **a implementação atual** de geração de cobranças na Alusa (Asaas whitelabel), incluindo regras de pagador por idade, boas práticas e pontos de auditoria.

---

## Escopo e fluxo afetado

Fluxo principal:

**matrícula → plano → cobrança (taxa) / assinatura (mensalidade) → pagamento (webhook) → status financeiro**

- **Matrícula** pode disparar:
  - **Assinatura (subscription)** no Asaas para mensalidades recorrentes (plano recorrente).
  - **Cobrança avulsa (payment)** no Asaas para taxa de matrícula (quando aplicável).

### Formas de pagamento (assinatura)

- Para assinatura recorrente, a Alusa cria a subscription no Asaas com `billingType: CREDIT_CARD`.
- O Asaas gera as cobranças recorrentes e confirma o estado financeiro **via webhooks**.
- A Alusa **não infere** pagamento; apenas reflete eventos do Asaas.

---

## Princípios e invariantes (obrigatórios)

### Fonte única da verdade financeira
- O Asaas é soberano para estados financeiros.
- **Nunca inferir** “pago”, “inadimplente”, “cancelado” localmente.
- Mudanças finais de status devem ocorrer por **webhook** (ou reconciliação explícita via GET).

### Pagador e idade (regra canônica)
A Alusa determina o pagador com base na idade do aluno no momento da operação:

- **Aluno ≥ 18 anos** → o **próprio aluno** é o pagador.
- **Aluno < 18 anos** → **responsável financeiro é obrigatório** e ele é o pagador.

**Regra canônica**: a decisão de pagador não pode estar espalhada por controllers/services.

### Aluno dependente e Customer
- Aluno menor de idade **não deve** ser cadastrado como Customer no Asaas.
- A criação/uso de Customer sempre respeita o pagador resolvido (ALUNO ou RESPONSÁVEL).

### Isolamento por subconta (whitelabel)
- Cada instituição opera em sua própria subconta/token Asaas.
- Não misturar:
  - Customers
  - Payments
  - Subscriptions

---

## Estrutura de implementação (onde está o quê)

### Regra de domínio (Single Source of Truth)
- `@alusa/domain`:
  - `resolvePayer({ alunoId, alunoDataNasc, responsavelFinanceiroId })`
  - Resultado:
    - `{ payer: { type: 'ALUNO' | 'RESPONSAVEL', id } }` em sucesso
    - erro quando menor sem responsável

Arquivos:
- `packages/domain/src/rules/matricula-rules.ts`
- `packages/domain/src/rules/matricula-rules.test.ts`

### Use-cases financeiros (infra/coordenação)
- `@alusa/finance`:
  - `ensureCustomer` (garante Customer no Asaas para o pagador)
  - `createCharge` (cobrança avulsa)
  - `createSubscription` (assinatura recorrente)
  - `createInstallmentPlan` (parcelamento, quando aplicável)

Arquivos:
- `packages/finance/src/use-cases/ensure-customer.ts`
- `packages/finance/src/use-cases/create-charge.ts`
- `packages/finance/src/use-cases/create-subscription.ts`
- `packages/finance/src/use-cases/create-installment-plan.ts`

### Validação da matrícula (backend web)
- `apps/web` valida precondições de cobrança com a regra canônica antes de disparar fluxos financeiros.

Arquivo:
- `apps/web/src/server/matriculas/matricula.service.ts`

---

## Precondições de negócio (antes de criar cobrança/assinatura)

### 1) Resolver pagador (idade)
- Buscar `aluno.dataNasc`.
- Executar `resolvePayer`.
- Se menor e sem `responsavelFinanceiroId` → falhar com erro explícito.

### 2) Garantir Customer do pagador no Asaas
- Para o pagador resolvido:
  - Se `payer.type === 'ALUNO'` → garantir Customer do aluno.
  - Se `payer.type === 'RESPONSAVEL'` → garantir Customer do responsável.

**Nota:** isso preserva o invariável “menor nunca vira Customer”.

### 3) Vincular cobrança ao contexto acadêmico
Toda cobrança/assinatura deve possuir vínculo rastreável:
- matrícula
- plano (quando houver)
- pagador resolvido
- instituição/subconta

---

## Regras de idempotência e anti-duplicidade

### Objetivo
Mesmo evento/ação pode ser executado mais de uma vez (retry, duplicidade de request, reenvio de webhook). O sistema deve resultar no mesmo estado final.

### Níveis de proteção
1) **Idempotência lógica (negócio)**
   - mesma matrícula + mesmo plano + mesmo período ⇒ não gerar duplicatas.
2) **Read-before-write (integração externa)**
   - antes de criar recurso no Asaas (POST), verificar se já existe (GET/list) e reaproveitar.
3) **Idempotência de webhook**
   - armazenar `eventId`/chave de idempotência + payload bruto.
   - reprocessar com segurança.

### Header de idempotência (Asaas)

- Todas as operações críticas de escrita no Asaas devem ser feitas com `Idempotency-Key`.
- A chave deve respeitar limites do Asaas; a Alusa gera uma chave segura e determinística a partir de um seed estável (evita exceder o limite e previne duplicidade em retries).

---

## Entidades / tabelas impactadas (persistência)

### No banco (Prisma)
- **Aluno**
  - `dataNasc` (base para regra de pagador)
  - `asaasCustomerId` (apenas quando o aluno é pagador e maior)
- **Responsável**
  - `asaasCustomerId` (quando responsável é pagador)
- **Matrícula**
  - `responsavelFinanceiroId` (obrigatório quando menor)
  - `asaasSubscriptionId` (quando plano recorrente)
- **Cobrança**
  - `asaasPaymentId` (cobrança avulsa)
  - `asaasSubscriptionId` (quando originada de assinatura)
  - `status` (atualizado por webhook)

---

## Chamadas Asaas (MCP) — quando seriam necessárias

### Leituras (antes de escrita)
- Buscar Customer por dados-chave (evitar duplicidade).
- Buscar payment/subscription por `externalReference` (se utilizado) ou IDs persistidos.

### Escritas (somente com intenção explícita)
- Criar Customer do pagador (se não existir).
- Criar cobrança avulsa (taxa) e salvar `paymentId`.
- Criar assinatura (mensalidade) e salvar `subscriptionId`.

### Confirmação pós-escrita
- Após POST, confirmar via GET e persistir IDs finais.

---

## Ajustes realizados (20/02/2026)

### O que mudou

- Assinaturas passaram a ser criadas no Asaas com `billingType: CREDIT_CARD` (sem conversão para `UNDEFINED`).
- A geração de `Idempotency-Key` foi mantida segura/curta para evitar rejeição do Asaas e permitir retries idempotentes.

### Impacto no fluxo

- Fluxo afetado: **matrícula → plano → assinatura (mensalidade) → pagamento (webhook) → status financeiro**.
- Invariantes preservados:
  - status financeiro **não é inferido** localmente;
  - confirmação **somente via webhook**;
  - reenvio/retry não gera duplicidade (idempotência).

### Observabilidade/auditoria

- Logs de integração devem registrar pelo menos: `contaId`, `matriculaId`, `subscriptionId`, `customerId`, `billingType` e a `Idempotency-Key` (quando aplicável) para correlação e reprocessamento.

---

## Webhooks: contrato e comportamento esperado

- Webhook é a confirmação oficial do Asaas.
- Processamento deve ser:
  - **idempotente** (N vezes = mesmo resultado)
  - **tolerante a reordenação** (eventos fora de ordem)
  - **tolerante a atraso**
- Persistir para auditoria:
  - `eventId` (ou equivalente)
  - payload bruto
  - timestamp de processamento

---

## Observabilidade, logs e auditoria

Requisitos mínimos:
- Logar operações críticas com correlação:
  - `contaId`, `matriculaId`, `alunoId`, `payer.type`, `payer.id`
  - IDs externos Asaas: `customerId`, `paymentId`, `subscriptionId`
- Salvar payload bruto de webhook para auditoria.
- Permitir reprocessamento de webhook sem efeitos colaterais.

---

## Casos de borda (esperados e cobertos)

### Menor de idade sem responsável
- Não deve criar cobrança/assinatura.
- Erro explícito: responsável financeiro obrigatório.

### Maior de idade sem responsável
- Deve criar cobrança/assinatura normalmente.
- Pagador = aluno.

### Reenvio de webhook
- Não duplicar efeitos (ex.: não marcar pago duas vezes, não criar duplicatas).

### Reordenação de eventos
- Não presumir transição “linear” (ex.: receber cancelamento antes de confirmação).

### Falha parcial
- Se criou recurso no Asaas mas falhou ao persistir localmente:
  - reconciliação via GET
  - reprocessamento idempotente

---

## Testes

- `packages/domain/src/rules/matricula-rules.test.ts`
  - cobre `resolvePayer` para maior/menor, com/sem responsável

---

*Atualizado em 21/01/2026 — regra de pagador por idade aplicada em todos os fluxos de cobrança.*

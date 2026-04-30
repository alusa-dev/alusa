# Plano de Implementação — Refatoração do Extrato Financeiro

## 1. Objetivo

Refatorar a página `/financeiro/extrato` para que ela represente um **ledger financeiro real** e não uma lista de cobranças, parcelas, assinaturas ou lançamentos híbridos.

O objetivo é alinhar o sistema ao modelo descrito em `extract.md`, preservando o que já existe nos fluxos de cobrança, assinatura, pagamento e webhook.

Este plano **não altera o fluxo de criar cobranças**, **não altera a origem soberana dos estados financeiros** e **não muda as regras acadêmico-financeiras já definidas**. Ele reorganiza o extrato para ser uma camada de leitura correta, auditável, profissional e sem duplicidade no workspace.

---

## 2. Fluxo afetado

Fluxo afetado: **matrícula -> plano -> cobrança -> pagamento**

Impacto do extrato dentro do fluxo:

* O extrato deixa de espelhar “cobranças” e passa a espelhar **movimentações financeiras efetivas** da conta.
* A matrícula continua vinculando plano, responsável financeiro e cobrança normalmente.
* O pagamento continua sendo confirmado pelo Asaas e por webhooks conforme o contrato já existente.
* O extrato passa a ser uma **visão de leitura** do que movimentou saldo no Asaas, com enriquecimento local opcional para exibir contexto acadêmico e operacional.

---

## 3. Invariantes que devem ser protegidos

* O extrato é **read-only** e não cria, altera, cancela ou confirma cobrança.
* Estados financeiros **não são inferidos localmente**.
* O Asaas continua sendo a fonte primária do extrato via `GET /v3/financialTransactions`.
* O extrato nunca substitui webhook como confirmação de pagamento.
* Um aluno dependente nunca vira customer por causa do extrato.
* O extrato nunca mistura subcontas: toda leitura usa a subconta correta da instituição.
* Enriquecimento local nunca pode reclassificar a verdade financeira oficial do Asaas.
* Uma cobrança pode gerar **múltiplas linhas no extrato**; a UI não pode assumir `1 cobrança = 1 linha`.

### 3.1 Invariantes adicionais de implementação

* `balanceAfter` nunca será recalculado localmente.
* `grossValue`, `fee`, `netValue`, `date`, `type` e `status` sempre derivam da leitura oficial do ledger e da normalização controlada do backend.
* Campos enriquecidos localmente, como `chargeName`, `customerName` e `metadata`, nunca substituem ou corrigem silenciosamente a semântica oficial do ledger.
* Mesma subconta + mesmos filtros + mesma janela temporal devem produzir a mesma consulta lógica e o mesmo resultado sem efeitos colaterais.

---

## 4. Situação atual e problemas a eliminar

Hoje existe uma base já parcialmente migrada, mas ainda há problemas estruturais:

1. A página atual em `apps/web/app/(app)/financeiro/extrato/page.tsx` concentra fetch, layout, filtros, tabela, drawer, formatação e regras visuais num único arquivo.
2. O contrato atual expõe um DTO ainda muito acoplado ao payload do Asaas (`asaasType`, `category`, `sign`, `value`, `balance`) e ainda não no formato final de ledger proposto em `extract.md`.
3. O resumo atual é `CURRENT_PAGE`, o que é conceitualmente incorreto para uma tela de extrato com filtro por período.
4. Ainda coexistem duas rotas para o mesmo domínio:

   * `apps/web/app/api/financeiro/extrato/route.ts`
   * `apps/web/app/api/finance/transactions/route.ts`
5. Existe artefato órfão/legado no workspace:

   * `apps/web/app/(app)/financeiro/extrato/page.tsx.bak`
6. Existem testes legados acoplados ao modelo errado de extrato/lançamento, como `apps/web/tests/unit/extrato.formatters.test.ts`.
7. Os filtros ainda não estão modelados como estado de URL nem organizados em hooks/feature própria.
8. O workspace ainda não trata o extrato como uma feature isolada, o que favorece duplicidade futura.

---

## 5. Fonte oficial e chamadas Asaas/MCP

### Fonte primária do extrato

* Endpoint oficial: `GET /v3/financialTransactions`
* Parâmetros oficiais confirmados no MCP do Asaas:

  * `offset`
  * `limit`
  * `startDate`
  * `finishDate`
  * `order`

### Chamadas Asaas/MCP necessárias

* Necessária: `GET /v3/financialTransactions` para listar o ledger oficial.
* Opcional e somente se estritamente necessário para enriquecimento futuro controlado: leituras adicionais de recursos já vinculados por IDs existentes.

### Chamadas Asaas/MCP que devem ser evitadas

* Evitar `POST`, `PUT` ou `DELETE` em qualquer recurso do Asaas para atender a tela de extrato.
* Evitar recriar customer, cobrança, assinatura ou pagamento para “corrigir” a tela.
* Evitar inferir extrato a partir de `payments`, `subscriptions`, `Charge` local ou tabelas acadêmicas sem ler o ledger oficial.

---

## 6. Entidades e tabelas afetadas

### Em runtime

O extrato refatorado deve operar prioritariamente em leitura.

Entidades/tabelas lidas:

* credenciais/subconta Asaas da conta da instituição
* `Charge` e vínculos financeiros já existentes, apenas para enriquecimento opcional
* entidades acadêmicas relacionadas à cobrança, apenas quando existir vínculo rastreável já persistido

Entidades/tabelas que **não devem ser mutadas** pelo extrato:

* cobrança
* assinatura
* matrícula
* plano financeiro
* customer financeiro
* webhook events

### Em código

Arquivos e módulos serão reorganizados para eliminar duplicidade e órfãos no workspace.

---

## 7. Arquitetura alvo

### 7.1 Contrato de backend alvo

O backend deve entregar um contrato estável e normalizado para a tela:

```ts
export type LedgerEntryType =
  | "RECEITA"
  | "TAXA"
  | "ESTORNO"
  | "TRANSFERENCIA"
  | "ANTECIPACAO"
  | "AJUSTE"

export type LedgerEntryStatus =
  | "CONFIRMADO"
  | "PENDENTE"
  | "CANCELADO"

export interface LedgerEntry {
  id: string
  externalId?: string
  date: string
  description: string
  type: LedgerEntryType
  status: LedgerEntryStatus
  grossValue: number
  fee: number
  netValue: number
  balanceAfter?: number
  chargeName?: string
  customerName?: string
  paymentId?: string
  transferId?: string
  source: "ASAAS"
  metadata?: {
    chargeId?: string
    contractId?: string
    subscriptionId?: string
    studentId?: string
    asaasType?: string
    rawCategory?: string
  }
}

export interface ExtratoResponse {
  summary: {
    receitas: number
    despesas: number
    estornos: number
    liquido: number
  }
  filters: {
    startDate?: string
    endDate?: string
    type?: string[]
    status?: string[]
    search?: string
    sort?: string
    direction?: "asc" | "desc"
  }
  transactions: LedgerEntry[]
  pagination: {
    page: number
    pageSize: number
    totalItems: number
    totalPages: number
    hasNextPage: boolean
  }
}
```

### 7.2 Responsabilidade por camada

* `packages/finance`: leitura oficial do Asaas, normalização do ledger, resumo e enriquecimento de domínio.
* `apps/web/app/api/financeiro/extrato`: BFF da página, autenticação, autorização e exposição do contrato final.
* `apps/web/features/financeiro/extrato`: composição da UI, filtros, tabela, drawer, estados e integração com URL.
* `apps/web/app/(app)/financeiro/extrato/page.tsx`: apenas entrypoint fino da página.

### 7.3 Estrutura alvo do workspace

```txt
apps/web/
  app/
    (app)/
      financeiro/
        extrato/
          page.tsx
    api/
      financeiro/
        extrato/
          route.ts
  features/
    financeiro/
      extrato/
        components/
          ExtratoHeader.tsx
          ExtratoSummaryCards.tsx
          ExtratoFiltersBar.tsx
          ExtratoTableSection.tsx
          ExtratoTable.tsx
          ExtratoTablePagination.tsx
          ExtratoEmptyState.tsx
          ExtratoDetailsDrawer.tsx
        hooks/
          useExtratoFilters.ts
          useExtratoQuery.ts
        services/
          get-extrato.ts
        dtos/
          index.ts
        utils/
          extrato-formatters.ts
          extrato-badges.ts
          extrato-columns.tsx
        ExtratoPage.tsx
        index.ts

packages/finance/
  src/
    dtos/
      ledger/
    mappers/
      ledger.mapper.ts
    services/
      ledger-enrichment.service.ts
    use-cases/
      list-ledger-entries.ts
      get-ledger-summary.ts
```

Observação: o repositório já usa `apps/web/features`, portanto a feature nova deve seguir esse padrão e **não** criar uma segunda convenção em `src/features`.

### 7.4 Regra de precedência entre fonte oficial e enriquecimento

A ordem de precedência da informação deve ser explícita:

1. `date`, `type`, `status`, `grossValue`, `fee`, `netValue`, `balanceAfter`, `paymentId`, `transferId` e a identidade da movimentação derivam do ledger oficial do Asaas e da normalização controlada do backend.
2. `chargeName`, `customerName` e `metadata` podem ser enriquecidos localmente quando houver vínculo rastreável confiável.
3. Em qualquer conflito entre dado local e dado oficial, prevalece o dado oficial.
4. Conflitos podem ser logados para auditoria operacional, mas nunca corrigidos silenciosamente por enriquecimento.

---

## 8. Estratégia de comportamento do extrato

### 8.1 Fonte da verdade

* A listagem base sempre vem do Asaas via `financialTransactions`.
* Dados locais servem apenas para enriquecer campos como `chargeName`, `customerName` e `metadata`.
* Se não houver vínculo local confiável, a movimentação continua sendo exibida normalmente com campos opcionais vazios.

### 8.2 Resumo

O resumo deve refletir **o mesmo período filtrado da tela**, não apenas a página atual.

Plano recomendado:

1. A tabela continua paginada em server-side.
2. O backend calcula `summary` para o filtro ativo, independentemente da página atual.
3. Como o Asaas não fornece `summary` pronto no endpoint, o backend deve fazer agregação controlada do período usando o mesmo `GET /v3/financialTransactions`.
4. Se for necessário paginar múltiplas chamadas para resumir o período, isso deve ocorrer no backend, nunca no cliente.
5. O cliente nunca recalcula resumo.

### 8.2.1 Regra formal de agregação do resumo

A agregação do resumo deve seguir uma regra explícita e testável:

* `RECEITA` compõe `receitas`
* `TAXA`, `TRANSFERENCIA`, `ANTECIPACAO` e `AJUSTE` com efeito de saída compõem `despesas`
* `ESTORNO` compõe `estornos`
* `liquido` deve ser calculado a partir da soma de `netValue` já normalizado por sinal no período filtrado

Regra operacional recomendada:

```ts
receitas = soma dos netValue das linhas classificadas como RECEITA
despesas = soma absoluta dos netValue negativos classificados como TAXA, TRANSFERENCIA, ANTECIPACAO ou AJUSTE
estornos = soma absoluta dos netValue negativos classificados como ESTORNO
liquido = soma algébrica dos netValue do período
```

Observações:

* O backend é o único responsável por essa agregação.
* A UI nunca recalcula cards.
* A lógica de classificação deve ser protegida por testes unitários.
* Se um tipo exigir tratamento excepcional, essa exceção deve ser centralizada no mapper ou use case de resumo, nunca no componente visual.

### 8.2.2 Regra para `balanceAfter`

* `balanceAfter` vem do ledger oficial quando disponível.
* Esse valor nunca é recalculado localmente.
* A UI trata `balanceAfter` como dado oficial de auditoria.
* Se estiver ausente para uma linha, a UI exibe ausência de forma neutra e não tenta inferir saldo.

### 8.2.3 Janela máxima e custo operacional do resumo

Como o resumo exige agregação do período inteiro:

* deve existir proteção para janelas amplas demais
* o backend pode aplicar:

  * limite máximo de janela operacional
  * cache curto por `contaId + filtros`
  * paginação interna com agregação incremental

Recomendação:

* começar com cache curto de resumo por filtro
* registrar tempo de cálculo
* prever hard limit ou fallback controlado se consultas de janelas muito amplas degradarem a operação

### 8.3 Filtros

Filtros desejados pela feature:

* `startDate`
* `endDate`
* `type[]`
* `status[]`
* `search`
* `page`
* `pageSize`
* ordenação

Regra de implementação:

* Filtros oficiais do Asaas sobem para o endpoint oficial.
* Filtros locais como `type`, `status` e `search` devem ser aplicados na camada de normalização/enriquecimento do backend, com paginação coerente do contrato final da página.
* O frontend só envia os filtros; ele não manipula o significado do dado financeiro.

### 8.3.1 Decisão arquitetural obrigatória sobre filtros locais e paginação

Para preservar consistência entre tabela, `totalItems`, `totalPages`, `hasNextPage` e resumo, a paginação final da UI deve ocorrer **depois** da aplicação dos filtros locais.

Estratégia recomendada:

1. O backend envia para o Asaas apenas os filtros oficiais delegáveis (`startDate`, `finishDate`, `order`, paginação interna necessária à coleta).
2. O backend coleta as páginas necessárias do ledger oficial dentro da janela filtrada.
3. O backend normaliza o ledger.
4. O backend aplica filtros locais (`type`, `status`, `search`) sobre o conjunto normalizado/enriquecido.
5. Somente depois disso o backend pagina o resultado final que será entregue à UI.

Consequências desejadas:

* `totalItems` e `totalPages` refletem o resultado realmente visível ao usuário
* não existe página vazia artificial causada por “paginou antes e filtrou depois”
* o resumo e a tabela permanecem semanticamente coerentes

Se no futuro houver restrição de custo que impeça essa abordagem em janelas muito grandes, a limitação deve ser explícita no contrato da feature, nunca implícita.

### 8.4 Status e tipagem

O contrato final deve reduzir a complexidade do payload oficial para um modelo estável de tela.

* `type` é semântico de UI e domínio de ledger.
* `status` é semântico de apresentação do lançamento no extrato.
* `asaasType` pode continuar existindo internamente ou em metadado técnico, mas não deve ser o eixo principal da UI.

### 8.4.1 Mapeamento e estabilidade semântica

* O mapeamento entre tipos oficiais do Asaas e `LedgerEntryType` deve ficar centralizado em uma camada única de normalização.
* O frontend nunca deve interpretar diretamente `asaasType`, `sign`, `category` ou combinações textuais do payload cru.
* `LedgerEntryStatus` também deve ser determinado no backend, não inferido em componentes da UI.

### 8.4.2 Ordenação

Ordenação padrão recomendada:

* `date desc`

Ordenações inicialmente suportadas:

* `date`
* `grossValue`
* `type`

Recomendação de escopo:

* não suportar inicialmente ordenações complexas por campos enriquecidos localmente, como `customerName`, se isso comprometer consistência, custo ou previsibilidade

### 8.5 Exportação futura

Não é parte obrigatória desta entrega, mas o contrato e a arquitetura devem ficar preparados para:

* exportação CSV/XLSX
* reaproveitamento do mesmo filtro da tela
* mesma lógica de classificação, resumo e ordenação aplicada à exportação

Regra:

* a exportação futura nunca deve ter semântica diferente da tela de extrato

---

## 9. Fases de implementação

## Fase 0 — Saneamento e congelamento do estado atual

### Objetivo

Criar uma linha de base segura antes da refatoração estrutural.

### Entregas

* Inventariar todos os pontos do extrato atual no web e no `packages/finance`.
* Mapear consumidores de:

  * `GET /api/financeiro/extrato`
  * `GET /api/finance/transactions`
  * `LedgerEntryDTO`
  * `ListLedgerEntriesResultDTO`
* Registrar o estado atual dos testes do extrato.

### Critérios de aceite

* Lista fechada de arquivos afetados.
* Lista clara de duplicidades e órfãos a eliminar.
* Nenhuma alteração funcional ainda.

---

## Fase 1 — Canonicalização do backend do ledger

### Objetivo

Definir um único contrato backend para o extrato.

### Entregas

* Evoluir os DTOs de ledger em `packages/finance` para o modelo final da tela.
* Introduzir `ExtratoResponse` como contrato estável do BFF.
* Manter a leitura oficial em `GET /v3/financialTransactions`.
* Remover do contrato exposto à UI a dependência direta de `summaryScope: CURRENT_PAGE`.
* Separar claramente:

  * DTO interno de integração com Asaas
  * DTO externo da página de extrato
* Centralizar a regra de mapeamento oficial -> `LedgerEntryType` e oficial -> `LedgerEntryStatus`.
* Formalizar a regra de cálculo de `grossValue`, `fee`, `netValue` e sinal.

### Critérios de aceite

* A UI não depende mais de campos brutos como eixo principal da renderização.
* O contrato final já suporta `summary`, `filters`, `transactions`, `pagination`.
* Nenhuma mutação financeira foi adicionada.
* A regra de normalização financeira está testável e concentrada em um único ponto.

---

## Fase 2 — Serviço de enriquecimento read-only

### Objetivo

Permitir que o extrato mostre contexto operacional sem trocar a fonte de verdade.

### Entregas

* Criar serviço de enriquecimento read-only no `packages/finance`.
* Resolver, quando houver vínculo rastreável:

  * `chargeName`
  * `customerName`
  * `metadata.chargeId`
  * `metadata.subscriptionId`
  * `metadata.contractId`
  * `metadata.studentId`
* Garantir que ausência de vínculo não quebre a linha do extrato.
* Garantir que o enriquecimento seja estritamente opcional e sem reclassificação financeira.

### Critérios de aceite

* O ledger oficial continua intacto.
* O enriquecimento é opcional, determinístico e sem efeitos colaterais.
* Nenhuma tabela financeira operacional é mutada.
* Conflito entre dado local e ledger oficial nunca altera a linha oficial.

---

## Fase 3 — Resumo correto do período

### Objetivo

Eliminar o comportamento incorreto de “resumo da página atual”.

### Entregas

* Criar mecanismo de agregação backend para o filtro ativo.
* Retornar os quatro cards finais:

  * `receitas`
  * `despesas`
  * `estornos`
  * `liquido`
* Garantir que o mesmo filtro aplicado na tabela seja o filtro do resumo.
* Se necessário, introduzir cache curto por `contaId + filtros` para evitar custo excessivo.
* Aplicar regra formal de agregação por tipo e sinal.
* Respeitar proteção operacional para janelas amplas.

### Critérios de aceite

* Os cards não dependem mais da página aberta.
* A mudança é transparente para a UI.
* O comportamento continua read-only.
* O resumo é semanticamente consistente com a tabela e com o contrato final.
* O backend suporta agregação do período sem depender do cliente.

---

## Fase 4 — Refatoração da UI para feature modular

### Objetivo

Tirar a página atual do formato monolítico e transformá-la numa feature profissional.

### Entregas

* Criar `apps/web/features/financeiro/extrato`.
* Extrair:

  * `ExtratoPage`
  * `ExtratoHeader`
  * `ExtratoSummaryCards`
  * `ExtratoFiltersBar`
  * `ExtratoTableSection`
  * `ExtratoTable`
  * `ExtratoTablePagination`
  * `ExtratoEmptyState`
  * `ExtratoDetailsDrawer`
* Transformar `app/(app)/financeiro/extrato/page.tsx` em entrypoint fino.
* Extrair utilitários de formatação e badges.
* Extrair colunas da tabela para utilitário dedicado.
* Garantir que o design preserve a base visual já existente, mas com semântica correta de ledger.

### Critérios de aceite

* Não existe mais arquivo gigante concentrando toda a feature.
* Componentes visuais não carregam regra financeira.
* A tela fica preparada para manutenção e revisão incremental.
* A tabela comunica visualmente que cada linha é uma movimentação de saldo.

---

## Fase 5 — Filtros sincronizados com URL e query layer

### Objetivo

Tornar o estado do extrato compartilhável, previsível e testável.

### Entregas

* Criar `useExtratoFilters` para sincronizar filtro com query string.
* Criar `useExtratoQuery` para leitura do extrato.
* Padronizar a URL com:

  * `startDate`
  * `endDate`
  * `type`
  * `status`
  * `search`
  * `page`
  * `pageSize`
  * `sort`
  * `direction`
* Trocar `fetch` manual espalhado por serviço/hook próprio.
* Definir ordenação padrão como `date desc`.

### Critérios de aceite

* Refresh do navegador preserva estado.
* Link pode ser compartilhado com o mesmo filtro aplicado.
* O cliente não recalcula nem reconstrói o contrato financeiro.
* A ordenação inicial da tela é previsível e coerente.

---

## Fase 6 — Tabela final e drawer de auditoria operacional

### Objetivo

Fechar a UX do extrato no modelo de ledger definido.

### Entregas

* Tabela principal com as colunas finais:

  * Descrição
  * Nome da cobrança
  * Data
  * Valor
  * Taxa
  * Tipo
  * Status
* Drawer lateral com:

  * descrição completa
  * tipo
  * status
  * valor bruto
  * taxa
  * líquido
  * saldo após movimentação
  * cliente
  * cobrança vinculada
  * `paymentId`
  * `transferId`
  * origem
  * metadados técnicos
* Estados explícitos de loading, empty e error.
* Acessibilidade mínima em tabela, filtros e drawer.
* Valores monetários alinhados à direita.
* Tipo e status usando badges consistentes.

### Critérios de aceite

* A UI comunica claramente que se trata de movimentação de saldo.
* Valores monetários ficam alinhados à direita.
* Tipo e status usam badges consistentes.
* Informações densas saem da tabela e vão para o drawer.
* A experiência fica adequada para suporte, financeiro e auditoria operacional.

---

## Fase 7 — Limpeza profissional do workspace

### Objetivo

Eliminar o jeito errado atual do extrato também no workspace, evitando duplicidade, confusão e arquivos órfãos.

### Entregas

* Remover `apps/web/app/(app)/financeiro/extrato/page.tsx.bak`.
* Consolidar uma única rota BFF canônica para a feature.
* Descontinuar a rota duplicada não escolhida como canônica.
* Remover ou reescrever testes que validam o modelo antigo de extrato/lançamento.
* Centralizar DTOs e utilitários da feature em `apps/web/features/financeiro/extrato`.
* Garantir que não existam dois contratos paralelos para o mesmo extrato.

### Decisão recomendada

Adotar `apps/web/app/api/financeiro/extrato/route.ts` como rota canônica da página e retirar a duplicidade com `apps/web/app/api/finance/transactions/route.ts`, salvo se houver consumidor externo ativo que exija uma janela explícita de compatibilidade.

### Estratégia de compatibilidade temporária

Se existir consumidor ativo da rota antiga:

* manter a rota antiga por janela curta e explícita de compatibilidade
* adaptar a rota antiga para delegar ao contrato novo
* marcar a rota antiga como deprecated
* remover definitivamente após a migração dos consumidores

### Critérios de aceite

* Não existem arquivos `.bak` relacionados à feature.
* Não existem duas rotas com o mesmo domínio sem necessidade explícita.
* Não existem testes cobrindo semânticas antigas sem dono.
* Se houver compatibilidade temporária, ela é consciente, documentada e finita.

---

## Fase 8 — Testes, rollout e proteção contra regressão

### Objetivo

Fechar a refatoração com proteção de contrato e regressão visual/comportamental.

### Entregas

* Testes unitários para:

  * mapeamento de tipos do Asaas para `LedgerEntryType`
  * cálculo de `fee`, `grossValue`, `netValue`
  * cálculo do resumo
  * filtros e paginação
  * regra de precedência entre ledger oficial e enriquecimento
* Testes de rota para o BFF do extrato.
* Testes de hook para URL sync.
* Testes de componente para tabela, empty state, error state e drawer.
* Teste e2e para o fluxo de navegação do extrato.

### Critérios de aceite

* A refatoração não quebra a tela.
* O contrato do extrato fica protegido por testes.
* O workspace termina sem cobertura órfã do modelo antigo.
* A classificação financeira e o resumo ficam blindados contra regressões.

---

## 10. Estratégia de idempotência, logs e auditoria

### Idempotência

Mesmo sendo uma feature read-only, o comportamento deve ser determinístico:

* mesma subconta + mesmos filtros + mesma janela temporal -> mesma consulta lógica
* enriquecimento local deve ser puro e sem side effects
* retries de leitura não podem causar mutação em cobrança, assinatura ou pagamento

### Logs esperados

Registrar pelo menos:

* `contaId`
* subconta usada
* filtros oficiais enviados ao Asaas
* filtros locais aplicados no backend
* tempo de resposta do Asaas
* quantidade de páginas lidas do Asaas
* quantidade de linhas retornadas
* quantidade de linhas enriquecidas
* paginação final devolvida ao frontend
* fallback de enriquecimento quando vínculo local não existir
* custo de agregação do resumo do período
* ocorrência de conflito entre dado local e ledger oficial, quando aplicável

### Auditoria

* Não há auditoria de mutação financeira nesta feature.
* Se houver persistência de telemetria, ela deve ser operacional, nunca financeira.
* O payload oficial do Asaas consumido para a página pode ser logado de forma resumida e segura, sem segredos.

---

## 11. Casos de borda obrigatórios

* Uma cobrança gerar múltiplas linhas no extrato.
* Pagamento e taxa compartilharem o mesmo `paymentId`.
* Linha de extrato não ter cobrança relacionada.
* Linha de extrato não ter cliente exibível.
* Estorno aparecer em data diferente do pagamento original.
* Transferência ou antecipação não ter contexto acadêmico.
* Busca textual não encontrar metadados locais.
* Janela ampla de datas exigir múltiplas páginas do Asaas para cálculo de resumo.
* Falha parcial no enriquecimento local sem perda da linha oficial do ledger.
* Divergência entre contexto local da cobrança e o ledger oficial do Asaas.
* Página final da UI continuar coerente após filtros locais.
* `balanceAfter` ausente sem tentativa de reconstrução local.
* Ordenação padrão consistente após refresh e compartilhamento da URL.

---

## 12. Ordem recomendada de execução

1. Fase 0
2. Fase 1
3. Fase 2
4. Fase 3
5. Fase 4
6. Fase 5
7. Fase 6
8. Fase 7
9. Fase 8

---

## 13. Resultado esperado ao final

Ao final desta refatoração, o sistema terá:

* um extrato realmente baseado em ledger
* uma página organizada por feature e pronta para escalar
* um contrato backend estável e desacoplado do payload cru do Asaas
* resumo coerente com o período filtrado
* drawer de detalhes útil para suporte, financeiro e auditoria operacional
* workspace limpo, sem rota duplicada, sem `.bak`, sem testes órfãos e sem o modelo antigo competindo com o novo
* paginação coerente mesmo com filtros locais
* regra formal de agregação protegida por testes
* precedência explícita entre ledger oficial e enriquecimento local
* base pronta para exportação futura sem divergência semântica

Esse resultado corrige o jeito errado atual do extrato sem tocar no fluxo de criar cobranças nem nas regras financeiras já consolidadas.

---

## 14. Decisões finais consolidadas

Para evitar ambiguidade durante a implementação, ficam fechadas as seguintes decisões:

* A fonte primária do extrato é `GET /v3/financialTransactions`.
* O extrato é estritamente read-only.
* A UI consome apenas contrato normalizado do backend.
* `summary` reflete o período filtrado, nunca a página atual.
* Filtros locais são aplicados no backend antes da paginação final da UI.
* `balanceAfter` nunca é recalculado localmente.
* Dado oficial do ledger sempre prevalece sobre enriquecimento local.
* A rota canônica do frontend será `apps/web/app/api/financeiro/extrato/route.ts`.
* A ordenação padrão será `date desc`.
* O extrato será organizado como feature em `apps/web/features/financeiro/extrato`.
* A tabela principal terá colunas enxutas, e os detalhes densos ficarão no drawer.
* A feature ficará preparada para exportação futura usando a mesma semântica da tela.

---

## 15. Checklist executivo de aceite final

A refatoração só deve ser considerada concluída quando todos os itens abaixo forem verdadeiros:

* a página `/financeiro/extrato` renderiza movimentações de saldo e não cobranças
* o backend expõe `ExtratoResponse` no contrato final
* a tela não depende mais de `summaryScope: CURRENT_PAGE`
* não existe mais regra financeira espalhada em componentes visuais
* `type`, `status`, `grossValue`, `fee`, `netValue` e `balanceAfter` vêm do backend
* o resumo e a tabela usam exatamente o mesmo filtro lógico
* o estado dos filtros está sincronizado com a URL
* existe drawer de detalhes operacional
* a rota duplicada antiga foi removida ou está explicitamente deprecada
* o `.bak` foi removido
* os testes antigos do modelo incorreto foram removidos ou reescritos
* existem testes protegendo classificação, resumo, paginação, URL sync e precedência de dados
* o workspace terminou sem duplicidade conceitual do extrato

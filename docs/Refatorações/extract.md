Sim — a forma **mais recomendada e mais sólida** para a Alusa é esta:

> **o frontend de Extrato deve representar um ledger financeiro**
>
> e não uma lista de cobranças, parcelas, assinaturas ou invoices.

Isso muda bastante a forma de pensar a tela.
O extrato não é “o que foi cobrado”.
O extrato é **o que movimentou saldo**.

Abaixo está a versão que eu recomendaria como **padrão de produção**, pensando em clareza, manutenção, auditabilidade e evolução futura.

---

# 1. Objetivo correto da tela de Extrato

A tela `/financeiro/extrato` deve responder a esta pergunta:

> **quais movimentações financeiras reais aconteceram na conta, em um período, e qual foi o impacto delas no resultado?**

Então o frontend deve ser construído para exibir:

* entradas
* saídas
* taxas
* estornos
* transferências
* antecipações
* saldo após movimentação, quando existir
* vínculo opcional com cobrança, aluno, contrato ou assinatura

Ou seja: a **entidade principal da página** não é `Payment`.
É `LedgerEntry` ou `FinancialTransaction`.

---

# 2. Modelo mental correto

## Não recomendado

```ts
Extrato = lista de cobranças pagas
```

## Recomendado

```ts
Extrato = lista de movimentações financeiras
```

Uma cobrança pode gerar várias linhas no extrato:

* recebimento
* taxa
* estorno
* chargeback
* repasse
* antecipação

Por isso o frontend não pode assumir que “1 cobrança = 1 linha”.

---

# 3. O que o frontend deve consumir

O frontend ideal **não deve consumir o payload cru do Asaas**.
O backend deve normalizar tudo e devolver um contrato estável.

## DTO recomendado

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
  }
}
```

---

# 4. Resposta ideal da API para a página

A página deve receber algo assim:

```ts
export interface ExtratoSummary {
  receitas: number
  despesas: number
  estornos: number
  liquido: number
}

export interface ExtratoFilters {
  startDate?: string
  endDate?: string
  type?: string[]
  status?: string[]
  search?: string
}

export interface ExtratoPagination {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
  hasNextPage: boolean
}

export interface ExtratoResponse {
  summary: ExtratoSummary
  filters: ExtratoFilters
  transactions: LedgerEntry[]
  pagination: ExtratoPagination
}
```

Exemplo:

```json
{
  "summary": {
    "receitas": 12850,
    "despesas": 920,
    "estornos": 300,
    "liquido": 11630
  },
  "filters": {
    "startDate": "2026-03-01",
    "endDate": "2026-03-31"
  },
  "transactions": [
    {
      "id": "led_001",
      "date": "2026-03-09",
      "description": "Pagamento recebido",
      "type": "RECEITA",
      "status": "CONFIRMADO",
      "grossValue": 120,
      "fee": 3.49,
      "netValue": 116.51,
      "balanceAfter": 3116.51,
      "chargeName": "Mensalidade Março",
      "customerName": "João Silva",
      "paymentId": "pay_xxx",
      "source": "ASAAS"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "totalItems": 134,
    "totalPages": 7,
    "hasNextPage": true
  }
}
```

---

# 5. Estrutura ideal da página

A composição mais recomendada seria:

```tsx
ExtratoPage
  ├── ExtratoHeader
  ├── ExtratoSummaryCards
  ├── ExtratoFiltersBar
  ├── ExtratoTableSection
  │     ├── ExtratoTableToolbar
  │     ├── ExtratoTable
  │     ├── ExtratoTablePagination
  │     └── ExtratoEmptyState
  └── ExtratoDetailsDrawer
```

Isso deixa a página limpa e fácil de manter.

---

# 6. Organização de componentes

## `ExtratoPage`

Responsável por:

* ler query params da URL
* buscar dados
* controlar loading / error / empty
* passar props para os componentes filhos

Ela **não** deve ter regra de negócio financeira.

---

## `ExtratoHeader`

Mostra:

* título “Extrato”
* subtítulo curto
* estado de atualização
* ações secundárias, como exportar CSV no futuro

Exemplo:

```tsx
<ExtratoHeader
  title="Extrato"
  subtitle="Movimentações financeiras da conta no período selecionado."
  updatedAt={dataUpdatedAt}
/>
```

---

## `ExtratoSummaryCards`

Mostra os 4 cards principais:

* Receitas
* Despesas
* Estornos
* Líquido

Boa prática:

* os valores vêm prontos do backend
* o componente só renderiza

```tsx
<ExtratoSummaryCards summary={data.summary} />
```

---

## `ExtratoFiltersBar`

Deve concentrar os filtros principais:

* intervalo de datas
* tipo
* status
* busca textual
* botão limpar filtros

Boa prática importante:

* filtros sincronizados com a URL
* isso melhora navegação, refresh, compartilhamento de link e debugging

Exemplo de URL:

```txt
/financeiro/extrato?startDate=2026-03-01&endDate=2026-03-31&type=RECEITA&type=TAXA&search=mensalidade
```

---

## `ExtratoTableSection`

Container visual da tabela, contendo:

* toolbar
* tabela
* estados
* paginação

Ajuda a encapsular melhor a área central da tela.

---

## `ExtratoTable`

Deve receber apenas:

* linhas
* estado de ordenação
* callbacks de interação

Não deve saber buscar dados nem recalcular summary.

---

## `ExtratoDetailsDrawer`

Ao clicar numa linha, abre um painel lateral com detalhes completos da movimentação:

* descrição completa
* ids internos e externos
* tipo normalizado
* status
* valor bruto
* taxa
* líquido
* saldo após movimentação
* cobrança vinculada
* cliente
* origem
* metadata técnica

Isso é excelente para suporte, financeiro e auditoria.

---

# 7. Estrutura de pastas recomendada

Se estiverem usando algo próximo de Next/React modular, eu recomendaria algo assim:

```txt
src/
  features/
    financeiro/
      extrato/
        components/
          extrato-header.tsx
          extrato-summary-cards.tsx
          extrato-filters-bar.tsx
          extrato-table.tsx
          extrato-table-row.tsx
          extrato-table-pagination.tsx
          extrato-empty-state.tsx
          extrato-details-drawer.tsx
        hooks/
          use-extrato-query.ts
          use-extrato-filters.ts
        services/
          get-extrato.ts
        types/
          extrato.types.ts
        utils/
          extrato-formatters.ts
          extrato-badges.ts
          extrato-columns.tsx
        index.ts
  app/
    financeiro/
      extrato/
        page.tsx
```

Essa estrutura tende a escalar bem.

---

# 8. Hook recomendado para dados

Eu faria um hook dedicado, algo assim:

```ts
export function useExtratoQuery(filters: ExtratoFilters, page: number) {
  return useQuery({
    queryKey: ["extrato", filters, page],
    queryFn: () => getExtrato({ ...filters, page }),
    staleTime: 30_000,
  })
}
```

Benefícios:

* cache previsível
* refetch simples
* separação do fetch da UI
* fácil de testar

---

# 9. Organização das colunas da tabela

A tabela ideal para o caso da Alusa ficaria assim:

| Descrição | Cobrança / referência | Cliente | Data | Valor bruto | Taxa | Líquido | Tipo | Status | Saldo |
| --------- | --------------------- | ------- | ---- | ----------- | ---- | ------- | ---- | ------ | ----- |

Mas, para não poluir a UI, eu sugiro duas opções:

## Opção A — tabela completa

Melhor para time financeiro.

## Opção B — tabela enxuta

Melhor para operação geral.

### Tabela enxuta recomendada

| Descrição | Nome da cobrança | Data | Valor | Taxa | Tipo | Status |

### Detalhes no drawer

| Saldo após | customerName | ids | origem | metadata |

Para a tela que você mostrou, eu recomendaria manter a versão enxuta e levar o restante para o drawer lateral.

---

# 10. Como cada coluna deve funcionar

## Descrição

Texto principal da movimentação.

Exemplos:

* Pagamento recebido
* Taxa de processamento
* Estorno de cobrança
* Transferência para conta bancária

Deve ser a coluna mais importante.

---

## Nome da cobrança

Campo opcional.

Pode mostrar:

* “Mensalidade Março”
* “Matrícula”
* “Plano anual”
* “—” quando não houver vínculo

Não force esse campo quando a movimentação não vier de cobrança.

---

## Cliente

Opcional também.
Se a tabela ficar muito carregada, deixe apenas no drawer.

---

## Data

Use data local formatada:

```txt
09/03/2026
```

Se precisar de precisão:

```txt
09/03/2026 às 13:42
```

---

## Valor

Aqui vale um cuidado importante:

o que o usuário costuma querer ver primeiro é o **valor bruto da movimentação**.

Exemplos:

* `+ R$ 120,00`
* `- R$ 500,00`

Visualmente:

* positivos destacados como entrada
* negativos como saída

---

## Taxa

Exibir sempre que existir.

Exemplos:

* `R$ 3,49`
* `—`

Não some taxa escondida dentro do valor sem transparência.

---

## Líquido

Pode estar na tabela ou no drawer.
Se couber bem, é excelente deixar visível.

Exemplo:

* bruto: `R$ 120,00`
* taxa: `R$ 3,49`
* líquido: `R$ 116,51`

---

## Tipo

Sempre com badge semântica.

Exemplo de mapeamento visual:

* Receita
* Taxa
* Estorno
* Transferência
* Antecipação
* Ajuste

---

## Status

Também em badge.

Exemplos:

* Confirmado
* Pendente
* Cancelado

---

## Saldo

Muito útil para auditoria, mas eu colocaria no drawer primeiro.
Pode virar coluna depois, caso o time financeiro precise.

---

# 11. Boas práticas visuais

## Hierarquia

* descrição com mais destaque
* referência/cobrança com menor peso visual
* data e badges com peso médio
* valores alinhados à direita

## Alinhamento

Colunas monetárias sempre alinhadas à direita:

* valor
* taxa
* líquido
* saldo

Isso melhora leitura financeira absurdamente.

## Densidade

Não deixe a tabela “gorda” demais.
Use linhas limpas, com respiro.

## Estados de vazio

Evite só “Nenhum registro encontrado”.
Melhor:

> Nenhuma movimentação foi encontrada para os filtros selecionados.

E oferecer botão:

* limpar filtros

---

# 12. Badges recomendadas

## Tipo

```ts
const typeLabelMap = {
  RECEITA: "Receita",
  TAXA: "Taxa",
  ESTORNO: "Estorno",
  TRANSFERENCIA: "Transferência",
  ANTECIPACAO: "Antecipação",
  AJUSTE: "Ajuste",
}
```

## Status

```ts
const statusLabelMap = {
  CONFIRMADO: "Confirmado",
  PENDENTE: "Pendente",
  CANCELADO: "Cancelado",
}
```

O ideal é manter isso em um arquivo tipo:

```txt
extrato-badges.ts
```

para não espalhar regras visuais na tabela inteira.

---

# 13. Filtros ideais

Eu recomendaria estes filtros:

## Obrigatórios

* data inicial
* data final
* busca textual

## Muito úteis

* tipo
* status

## Futuramente

* cliente
* origem
* faixa de valor
* apenas com taxa
* apenas estornos

---

# 14. Busca textual: como deve funcionar

A busca deve tentar casar com:

* descrição
* nome da cobrança
* nome do cliente
* id externo
* referência relacionada

Mas isso deve ser decidido no backend.
O frontend apenas envia `search`.

---

# 15. Ordenação recomendada

Padrão:

* data decrescente

Ordenações úteis:

* data
* valor
* tipo

Mas não exagere no número de ordenações no início.

---

# 16. Paginação recomendada

Para extrato, eu recomendo:

* 20 ou 25 itens por página
* paginação server-side
* query params na URL

Exemplo:

```txt
?page=2&pageSize=20
```

Se o backend usar cursor, tudo bem, mas a interface ainda pode parecer paginada normalmente.

---

# 17. Estados da UI

## Loading

Use skeleton para:

* cards de resumo
* linhas da tabela

## Empty

Mensagem clara + limpar filtros

## Error

Mensagem amigável + botão tentar novamente

Exemplo:

> Não foi possível carregar o extrato agora.

---

# 18. Drawer de detalhes: altamente recomendado

Isso é uma das melhores melhorias para uma tela dessas.

Ao clicar na linha:

```tsx
<ExtratoDetailsDrawer entry={selectedEntry} open={open} onOpenChange={setOpen} />
```

Conteúdo ideal:

* descrição
* tipo
* status
* data/hora
* valor bruto
* taxa
* valor líquido
* saldo após
* cliente
* cobrança associada
* paymentId
* transferId
* source
* ids técnicos

Isso evita que a tabela fique lotada e, ao mesmo tempo, deixa a solução madura.

---

# 19. Boas práticas de frontend

## 1. Não recalcular resumo no cliente

Resumo vem do backend.
Isso evita divergência.

## 2. Não inferir semântica com base em strings do Asaas no componente

O backend já deve mandar `type` normalizado.

## 3. Não misturar renderização com transformação de dados

O componente deve receber dado pronto.

## 4. Sincronizar filtros com URL

Muito importante.

## 5. Formatar moeda e data em utilitários

Exemplo:

* `formatCurrency`
* `formatDate`

## 6. Evitar componente gigante

A página não deve virar um arquivo de 500 linhas.

## 7. Separar colunas em utilitário

Se estiverem usando TanStack Table, ótimo:

* `extrato-columns.tsx`

---

# 20. Exemplo de tipagem mais madura

```ts
export interface ExtratoPageState {
  filters: {
    startDate?: string
    endDate?: string
    search?: string
    type?: LedgerEntryType[]
    status?: LedgerEntryStatus[]
  }
  pagination: {
    page: number
    pageSize: number
  }
  sorting: {
    field?: "date" | "grossValue" | "type"
    direction?: "asc" | "desc"
  }
}
```

---

# 21. Exemplo de composição da página

```tsx
export function ExtratoPage() {
  const { filters, setFilters, page, setPage } = useExtratoFilters()
  const { data, isLoading, isError, refetch } = useExtratoQuery(filters, page)
  const [selectedEntry, setSelectedEntry] = useState<LedgerEntry | null>(null)

  return (
    <div className="space-y-6">
      <ExtratoHeader
        title="Extrato"
        subtitle="Movimentações financeiras da conta no período selecionado."
      />

      <ExtratoSummaryCards summary={data?.summary} loading={isLoading} />

      <ExtratoFiltersBar
        filters={filters}
        onChange={setFilters}
      />

      <ExtratoTableSection>
        <ExtratoTable
          rows={data?.transactions ?? []}
          loading={isLoading}
          error={isError}
          onRowClick={setSelectedEntry}
        />

        <ExtratoTablePagination
          pagination={data?.pagination}
          onPageChange={setPage}
        />
      </ExtratoTableSection>

      <ExtratoDetailsDrawer
        entry={selectedEntry}
        open={!!selectedEntry}
        onOpenChange={(open) => !open && setSelectedEntry(null)}
      />
    </div>
  )
}
```

---

# 22. O que eu mudaria na sua tela atual

Pelo screenshot, eu manteria bastante coisa.
A base visual está boa.

Eu ajustaria assim:

## Manter

* cards de resumo no topo
* tabela central
* filtros no topo da tabela
* layout limpo

## Melhorar

* deixar claro que é movimentação financeira
* revisar colunas para o modelo de ledger
* incluir drawer de detalhes
* adicionar estado vazio melhor
* garantir que os cards reflitam o mesmo período filtrado
* alinhar melhor os valores monetários
* adicionar tipo/status como badges consistentes
* talvez incluir líquido ou saldo em detalhes

---

# 23. Recomendação final de colunas para a Alusa

Eu recomendaria começar com estas:

| Descrição | Nome da cobrança | Data | Valor | Taxa | Tipo | Status |
| --------- | ---------------- | ---- | ----- | ---- | ---- | ------ |

E no drawer mostrar:

* líquido
* cliente
* saldo após
* ids
* origem
* referência interna

Essa é uma combinação muito boa entre:

* simplicidade
* precisão
* escalabilidade

---

# 24. Prompt pronto para o Copilot

Aqui está um prompt mais forte, mais completo e mais bem direcionado para a refatoração do frontend:

```text
Refatore a página de Extrato financeiro da aplicação para seguir o modelo correto de ledger financeiro.

Contexto:
Hoje a tela de extrato não deve ser tratada como lista de cobranças. Ela deve representar movimentações reais de saldo da conta, vindas do backend já normalizadas a partir de financialTransactions do Asaas.

Objetivo:
Reestruturar o frontend da página /financeiro/extrato para consumir um DTO de ledger financeiro e renderizar uma interface consistente, auditável e escalável.

Requisitos de arquitetura:
- Separar a feature em uma pasta própria: financeiro/extrato
- Criar componentes pequenos e reutilizáveis
- Não colocar regra de negócio financeira nos componentes visuais
- Toda normalização de tipos e valores deve vir pronta do backend
- Sincronizar filtros com a URL
- Usar paginação server-side
- Preparar a página para suportar drawer/modal de detalhes da movimentação

Estrutura de componentes desejada:
- ExtratoPage
- ExtratoHeader
- ExtratoSummaryCards
- ExtratoFiltersBar
- ExtratoTableSection
- ExtratoTable
- ExtratoTablePagination
- ExtratoEmptyState
- ExtratoDetailsDrawer

Modelo esperado do dado:
LedgerEntry:
- id
- date
- description
- type
- status
- grossValue
- fee
- netValue
- balanceAfter
- chargeName
- customerName
- paymentId
- transferId
- source

Response esperada:
{
  summary: {
    receitas,
    despesas,
    estornos,
    liquido
  },
  transactions: LedgerEntry[],
  pagination: {
    page,
    pageSize,
    totalItems,
    totalPages,
    hasNextPage
  }
}

Layout desejado:
1. Header da página
2. Cards de resumo
3. Barra de filtros
4. Tabela principal
5. Paginação
6. Drawer de detalhes ao clicar em uma linha

Colunas da tabela:
- Descrição
- Nome da cobrança
- Data
- Valor
- Taxa
- Tipo
- Status

Regras visuais:
- Valores monetários alinhados à direita
- Tipo e Status renderizados com badges
- Receitas positivas e saídas negativas claramente distinguíveis
- Empty state amigável
- Loading com skeleton
- Error state com ação de retry

Boas práticas:
- Extrair formatadores para utilitários
- Extrair colunas da tabela para arquivo próprio
- Criar hook useExtratoQuery
- Criar hook useExtratoFilters
- Evitar arquivo gigante
- Preparar tipagem forte para LedgerEntry, Summary e Pagination
- Garantir acessibilidade básica em tabela, filtros e drawer

Faça a refatoração preservando o design base atual da página, mas corrigindo o modelo conceitual para extrato financeiro real.
```

---

# 25. Minha recomendação mais direta

Se eu estivesse guiando essa refatoração na Alusa, eu faria nesta ordem:

1. definir o contrato `LedgerEntry`
2. ajustar a API interna `/financeiro/extrato`
3. refatorar a página para consumir esse contrato
4. separar componentes
5. adicionar drawer de detalhes
6. sincronizar filtros com URL
7. revisar estados de loading/empty/error

Essa é a forma mais limpa de sair de uma implementação “parecida com cobranças” para um **extrato financeiro de verdade**.

Se você quiser, no próximo passo eu posso te entregar um **plano de refatoração já adaptado ao seu projeto**, com:

* nomes de arquivos
* estrutura de pastas
* ordem de implementação
* e esqueleto de componentes em React/Next.

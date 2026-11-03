# Delivery Brief: identidade canônica do evento Asaas

## Problema e fluxo afetado

A fila persistia o ID validado do envelope em `WebhookAsaas.eventId`, mas reconstruía a mensagem dando preferência a `payload.id`. O sanitizador de payload pode substituir sequências numéricas semelhantes a telefone/documento dentro de IDs. Isso propagou um alias redigido para `lastCauseId` de revisões de origem desconhecida; o preflight operacional falhou de forma segura antes de corrigir os dados.

## Correção

- A fila passa o ID indexado à camada de handlers, usando o ID do corpo apenas quando o indexado for nulo. Deduplicação, índices, payloads históricos e sanitização de PII/segredos permanecem preservados.
- O CLI e a resolução genérica de revisões filhas usam o mesmo resolvedor de prova. A busca combina tabela ativa e arquivo, com tenant, pagamento indexado e igualdade exata do ID indexado ou do ID completo armazenado no payload.
- A prova exige uma única identidade canônica não vazia e coincidência de pagamento do payload, assinatura pai e tipo de evento indexado/do payload com a issue. Duplicatas do mesmo evento no arquivo são aceitas; aliases ambíguos ou snapshots conflitantes falham de forma segura. Não há remoção de máscaras, aproximação por prefixo ou inferência por pagador.
- A auditoria registra o `canonicalEventId` confirmado junto à causa legada. A resolução continua limitada pelos guards locais e pelo CAS da causa, versão, tenant e pagamento da issue. Não há replay financeiro.

## Verificação

A bateria direcionada cobre precedência do ID canônico na fila, aliases legados e IDs normais, duplicatas e colisões entre tabela ativa/arquivo, conta/pagamento/assinatura/evento incorretos e preservação de issues quando CAS ou ownership mudam. Os testes reais de PostgreSQL criam fixtures em transações revertidas, sem alterar triggers ou excluir histórico append-only. O comando direcionado executou nove suites: oito passaram (250 testes); os dois testes preexistentes de `asaas-webhook-reprocess.test.ts` falharam no cleanup de `Conta.deleteMany`, bloqueado pela FK de `PlatformBillingEligibilityCoverage` append-only. Os sete testes novos com PostgreSQL passaram com rollback integral. Não foram alterados testes/constraints/triggers para contornar o teardown. `pnpm --filter @alusa/finance typecheck` e `git diff --check` passaram. Reviews aplicáveis e gate final permanecem com o coordenador.

## Operação

Nenhuma migration ou alteração em payload/index existente. O worker não executou recovery, escrita de produção, commit ou push. A recuperação continua dependendo do manifesto revisado e de novo dry-run; somente o coordenador executa as operações autorizadas após os gates aplicáveis.

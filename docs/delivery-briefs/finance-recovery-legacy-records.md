# Delivery Brief: recuperação de registros legados

## Escopo

Ajuste somente no CLI operacional e seus testes. O dry-run revelou dois formatos históricos diferentes dos formatos esperados pelo comando: uma revisão já reparada de ciclo recorrente com marcador textual e uma ambiguidade de customer de evento com `asaasId` nulo e sem causa de webhook. Nenhum marcador, referência ou payload histórico é reescrito para adequá-lo à ferramenta.

## Provas exigidas

- Ciclo recorrente: o sufixo de `enrollment-op:<op>:subscription:payment:<payment>` precisa ser o ID exato do pagamento. A operação deve estar `COMMITTED`, com assinatura Asaas e matrícula iguais às da Subscription ativa e da Cobranca. Charge aberta e Cobranca `PENDENTE`/`A_VENCER` precisam estar vinculadas entre si, ao pagamento e à entidade já registrada na revisão, com valor e vencimento UTC coincidentes. GETs de pagamento e assinatura devem confirmar ID, pai e referência de assinatura, com pagamento `PENDING`, valor/data iguais e assinatura ativa. O primeiro pagamento da operação não é usado como identidade de um ciclo posterior.
- Evento legado: a alternativa de identidade em `metadata.paymentId` só é aceita com `asaasId` originalmente nulo, `lookupError=MULTIPLE_BUYER_CUSTOMERS` e `remoteStatus=BUYER_CUSTOMER_NOT_CONFIRMED`. O pedido deve estar `CANCELLED`, com provider Asaas, mesmo payment e `paymentStatus=DELETED`; O GET deve comprovar o alvo conhecido excluído; a listagem completa disponível pela referência, usando somente filtros documentados, não pode expor alternativa. Lista vazia é aceita somente após esse GET, pois o endpoint pode omitir excluídos; o alvo, se listado, precisa coincidir integralmente com o snapshot verificado. `reason` ausente é aceito somente nesse legado com causa ausente; qualquer motivo presente conflitante é rejeitado.
- Ambos os caminhos repetem a validação local dentro da transação serializable e resolvem somente a observação ainda aberta do manifesto. O CAS compara tenant, identidade original da issue, versão e metadata completa; o evento preserva `asaasId=null`, sem inventar causa. A trilha de auditoria registra o pagamento comprovado.
- Observações abertas com versão nova retornam `SKIPPED_STALE`. Issues já resolvidas por outro verificador retornam `ALREADY_RESOLVED`, sem novas gravações. Não há atualização automática do manifesto nem expansão de IDs aprovados.

## Validação

A cobertura inclui os formatos reais de ciclo e evento, primeiro pagamento diferente, referência/pai/estado/valor/data incorretos, concorrência local e CAS, duplicatas, paginação incompleta, listagem vazia após GET terminal e motivos conflitantes, além da descoberta dos dois registros pelo entrypoint dry-run completo. Cinco suites direcionadas passaram (115 testes, incluindo 32 de recovery). `pnpm --filter @alusa/finance typecheck`, TypeScript isolado do CLI com `noEmit` e `git diff --check` passaram. O startup do comando foi confirmado em `.env.test` com arquivo de manifesto deliberadamente inexistente, chegando ao `ENOENT` esperado sem consultar o provedor. Reviews e novo dry-run operacional permanecem com o coordenador.

Nenhuma migration, alteração de aplicação, commit, push ou escrita em produção foi executada pelo worker. O coordenador mantém o manifesto revisado fora do repositório e executa novo dry-run antes da operação autorizada.

# Consistência outbound Alusa → Asaas

Este protocolo cobre criação de pagamentos, assinaturas e parcelamentos. O Asaas continua sendo a fonte de verdade do estado financeiro; a Alusa mantém intenção, vínculo e snapshots para operar sem depender da interface externa.

## Protocolo

1. Validar tenant, KYC, webhook e pagador.
2. Gerar `externalReference`, `idempotencyKey` e fingerprint determinísticos.
3. Persistir a entidade em estado solicitado, quando aplicável, e reservar um `AsaasIntegrationJob` tenant-scoped.
4. Consultar o Asaas por ID remoto conhecido ou `externalReference` antes de qualquer `POST`.
5. Adquirir atomicamente o direito de enviar o `POST`; apenas um concorrente pode fazê-lo.
6. Enviar com `Idempotency-Key` estável.
7. Confirmar imediatamente o recurso com `GET` e comparar referência, pagador, valor, vencimento e quantidade quando disponíveis.
8. Persistir o ID remoto e aguardar o webhook oficial.
9. Webhook ou reconciliação ativa concluem o job e convergem o estado local.

## Estados operacionais

- `INTENT_CREATED`: intenção local durável, sem I/O remoto confirmado.
- `REMOTE_REQUESTED`: um worker adquiriu o envio remoto.
- `REMOTE_CONFIRMED`: o recurso foi relido e validado no Asaas.
- `AWAITING_WEBHOOK`: vínculo persistido, aguardando o canal oficial.
- `SYNCHRONIZED`: webhook ou reconciliação confirmaram a convergência.
- `RESULT_UNKNOWN`: o `POST` pode ter sido aceito, mas a resposta foi perdida; nunca repetir às cegas.
- `REQUIRES_RECONCILIATION`: limite de recuperação esgotado; job em DLQ lógica e divergência crítica aberta.

Os estados detalhados ficam no payload versionado do `AsaasIntegrationJob`; os estados físicos `PENDING`, `PROCESSING`, `DONE` e `FAILED` mantêm compatibilidade com workers, health checks e suporte existentes.

## Operação

O cron `/api/jobs/reconcile-payment-commands` também executa `reconcileOutboundFinancialOperations`. Ele procura recursos por `externalReference`, rejeita resultados múltiplos, materializa vínculos faltantes e usa o pipeline canônico de sincronização de pagamentos.

Após cinco buscas sem encontrar o recurso, a operação vai para `REQUIRES_RECONCILIATION`. Um webhook tardio ainda pode concluir um job nessa situação. Duplicidades remotas nunca são resolvidas escolhendo um registro arbitrariamente.

Toda busca, atualização e correlação inclui `contaId`; credenciais são carregadas exclusivamente pelo tenant do job.


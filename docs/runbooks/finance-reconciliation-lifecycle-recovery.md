# Recuperação do ciclo de reconciliação financeira

## Objetivo

Este runbook corrige alertas de origem desconhecida e divergências antigas sem alterar histórico financeiro, recriar recursos no Asaas ou associar pagamentos a matrículas por semelhança de pagador.

O detector de ausência de eventos agora retorna candidatos para verificação. Idade sem webhook, por si só, não abre uma falha financeira nem altera o status geral de saúde. Backlog real, DLQ, risco de retenção, SLO e webhook pausado continuam sendo alertas operacionais.

## Pré-requisitos

- Use o manifesto revisado fora do repositório. Ele contém IDs tenant-scoped e evidência aprovada; não o copie para git nem imprima chaves Asaas.
- Confirme o tenant e o ator administrativo responsável pela execução.
- O comando consulta cada assinatura/pagamento aprovado com GET atual do Asaas e adquire lock por tenant.
- O padrão é dry-run. `--apply` executa somente depois que a saída e o manifesto forem revisados.

```bash
pnpm finance:recover-reconciliation -- --manifest /caminho/seguro/manifest.json
```

Para aplicar a recuperação revisada:

```bash
pnpm finance:recover-reconciliation -- --manifest /caminho/seguro/manifest.json --operator <rótulo-do-operador> --apply
```

O comando classifica somente as assinaturas explicitamente aprovadas como `EXTERNAL`, após elegibilidade local e GET remoto. Os pagamentos filhos precisam apontar para uma única assinatura aprovada no GET remoto e no evento armazenado. As issues `PAYMENT_NEEDS_REVIEW` são resolvidas por CAS com tenant, issue, pagamento, causa e `lastSeenAt`; nenhum evento é reproduzido e nenhuma origem de pagamento individual é inferida por ausência de `externalReference`.

Para uma cobrança histórica explicitamente revisada como matrícula encerrada, o GET precisa confirmar o mesmo pagamento, referência externa e assinatura inativa/excluída. O comando registra a disposição auditada e fecha apenas a issue indicada. Não cria matrícula, Charge, Cobranca ou vínculo substituto.

Issues de pedido de evento só são resolvidas se o mesmo tenant ainda tiver o pedido `CANCELLED`/`EXPIRED`, o mesmo ID de pagamento Asaas e a mesma referência `event-map-order:<orderId>`, o GET confirmar o pagamento excluído e a busca paginada completa dessa referência retornar exatamente esse único pagamento excluído. Respostas incompletas, pagamentos duplicados ou outro recurso ativo deixam a issue aberta. Outros `BILLING_OPERATION_UNCERTAIN` permanecem abertos.

## Verificação dos alertas de webhook

O comando executa uma reconciliação tenant-scoped de até 40 chamadas Asaas, com janela de 90 segundos e intervalo mínimo de cinco minutos. Esse intervalo curto existe só para esta execução pontual, limitada pelo lock e pelo manifesto; o cron normal mantém seis horas. Alertas `WEBHOOK_LAG` locais são selecionados mais antigos primeiro e verificados por identidade exata, inclusive Charge/Cobranca canceladas. Recursos terminais sem entidade local podem ser fechados somente após GET de identidade e estado terminal. O CAS compara `contaId`, chave/issue, estado OPEN e versão `lastSeenAt`; uma observação mais nova continua aberta. O detector não percorre todo o histórico pago/refundado.

A janela temporal limita o início de novos GETs; não cancela chamadas do SDK em andamento. Retries, backoff e `Retry-After` internos podem ultrapassar essa janela e contam como uma única operação de reconciliação. Quando há pagamentos e assinaturas, uma única leitura de assinatura é iniciada antes do lote de pagamentos, contabilizada antecipadamente e consumida mesmo se o prazo vencer; nenhuma segunda leitura é iniciada para esse recurso. O orçamento unitário alterna conforme as tentativas registradas no último passe concluído do tenant, inclusive tentativas com falha. Sem histórico, ou com contagens iguais/zero, a assinatura recebe a primeira tentativa. Classes vazias não reservam orçamento.

Se a saída mostrar orçamento esgotado, drift, erro ou issue stale, não force o limite nem repita imediatamente. Preserve os alertas e agende a próxima verificação conforme o intervalo; investigue falha reproduzível antes de qualquer correção manual.

## Resultado confirmado desta investigação

- 80 assinaturas pai e 92 cobranças filhas foram aprovadas pela instituição como mensalidades externas de tuition. Todos os GETs remotos confirmaram o vínculo filho→pai e não há referência canônica Alusa nem entidade acadêmica local correspondente. A classificação externa não reproduz eventos nem cria lançamentos.
- Um pagamento de R$ 170 recebido em mãos foi confirmado como histórico de matrícula encerrada: a assinatura antiga está inativa e excluída, e não existe matrícula/charge/cobrança local. A mesma pessoa pagadora possui outra assinatura ativa hoje; isso não autoriza associar o pagamento antigo à matrícula atual. O histórico permanece no Asaas e a resolução registrada é apenas operacional.
- As 32 divergências restantes de webhook são verificadas pelo passe de snapshot limitado do comando, sem tomar ausência de evento como falha financeira.
- A incerteza de criação de mensalidade com `REMOTE_CREATION_RESULT_STILL_UNCERTAIN` permanece aberta para intervenção manual. A busca completa não encontrou a referência, mas isso não prova que o recurso remoto nunca existiu. Não repetir POST, não inventar vínculo e não marcar como resolvida por esgotamento de tentativas.

O registro legado com 5.648 tentativas é histórico (última tentativa em 22/10/2026), não evidência de loop atual; a operação tem status de reconciliação e continua sem criação automática. O job outbound relacionado tem quatro tentativas e registra recurso remoto não encontrado durante reconciliação, mas o resultado permanece inconclusivo.

## Auditoria e segurança

Classificações e disposições executadas pelo CLI são auditadas como `SYSTEM`, com `runId` de correlação e rótulo do operador informado; o comando não atribui a automação a um usuário ADMIN autenticado. O rótulo do operador é obrigatório em `--apply`. A recuperação é serializada por lock tenant-scoped. O dry-run faz apenas leituras de domínio e chamadas GET; grava somente o lease operacional do lock. O modo apply pode classificar decisões de origem, resolver issues auditáveis e atualizar snapshots pelo reconciliador existente. A execução pode ser repetida: classificações já externas não são recriadas; issues resolvidas pela mesma disposição são idempotentes; divergência entre manifesto, DB e GET interrompe a execução.

Nenhuma migration, exclusão de histórico, SQL de atualização de domínio ou mutação no Asaas é necessária para esta recuperação.

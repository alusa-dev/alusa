# Delivery Brief: ciclo de reconciliação financeira

## Fluxo afetado

Webhooks Asaas → fila e diagnósticos → reconciliação de snapshots → issues financeiras e revisão operacional.

## Mudança

- Ausência de evento continua disponível como diagnóstico e candidato a verificação, mas não abre automaticamente issue financeira nem torna o diagnóstico de webhook `WARNING`.
- Issues `WEBHOOK_LAG` abertas são verificadas por lookup tenant-scoped, ordenadas pela observação mais antiga e limitadas pelo orçamento existente. A reconciliação inclui identidades locais canceladas somente quando elas já constam em issue aberta; não expande a busca periódica por todo o histórico finalizado.
- O orçamento compartilhado reserva chamadas e inicia um único GET de assinatura antes dos pagamentos quando há backlog das duas classes; o resultado é consumido mesmo se o prazo vencer. A janela temporal limita novos inícios, sem cancelar retries internos do SDK; dentro das assinaturas, observações de lag mais antigas são verificadas primeiro. Com uma chamada por execução, a classe consultada alterna a partir do último `FinanceReconciliationRun` concluído da conta. Falhas de GET atualizam o cursor tenant-scoped por CAS para aplicar o intervalo de verificação e evitar retry sem limite.
- Snapshot consistente resolve lag com compare-and-set por `contaId`, dedupe key, status e `lastSeenAt`. Divergência confirmada abre issue específica e só fecha o alerta antigo se a mesma observação continuar vigente.
- Adicionado comando operacional dry-run por padrão, com lock por tenant, manifesto exato, GET atual Asaas, validação de preview local e auditoria. O modo apply exige `--apply` explícito e um rótulo de operador; o CLI registra `SYSTEM` com `runId` de correlação, sem atribuir ações a um ADMIN autenticado.
- As assinaturas externas aprovadas autorizam a resolução das issues dos pagamentos filhos somente após confirmar o vínculo exato pai/filho no Asaas e no evento persistido. Não há replay ou criação de lançamentos.
- A cobrança histórica de matrícula encerrada requer disposição explícita no manifesto e confirmação remota de referência, pagamento e assinatura antiga excluída. A resolução não cria nem associa entidades locais.
- Issues de pedidos de evento cancelados só são fechadas quando pedido local, pagamento Asaas e externalReference coincidem e o GET confirma exclusão.

## Decisões de domínio e risco

`contaId` é obrigatório em queries, lock, atualização CAS e auditoria. O resultado `RECEIVED_IN_CASH` do Asaas não é tratado como pagamento manual Alusa. A incerteza do POST `REMOTE_CREATION_RESULT_STILL_UNCERTAIN` continua aberta; inexistência em busca não prova que o recurso nunca foi criado. O caso legado de R$ 170 permanece no histórico da assinatura inativa/excluída e não é ligado à matrícula atual do mesmo pagador.

Não houve migration. O worker não executou operações de produção nem alterações no Asaas.

## Verificação

Checks direcionados no pacote `@alusa/finance`: 11 arquivos/298 testes passaram e `pnpm --filter @alusa/finance typecheck` passou. A cobertura inclui backlog com orçamento baixo, GETs de 65 segundos com sucesso/falha que esgotam o prazo sem perder o resultado reservado, prefetch do acordo canônico, alternância durável de orçamento unitário incluindo falhas, persistência do passe parcial sob lock, corridas de ownership em pagamentos/assinaturas/cobranças, eventos duplicados/fora de ordem e closure de pedido de evento por evidência exata. O CLI foi iniciado com `.env.test` e manifesto deliberadamente inexistente: chegou ao erro esperado `ENOENT` sem acessar banco/provedor. O comando usa `tsx --tsconfig tsconfig.base.json` para resolver os sources do workspace em vez de artefatos `dist` locais. O check TypeScript isolado anterior do script não encontrou diagnóstico no arquivo do comando; encontrou erros em módulos financeiros preexistentes importados, enquanto o typecheck oficial do pacote passou. `git diff --check` passou. O teste de integração de pagamento manual executou as asserções, mas terminou com falha no teardown: o banco de teste rejeita exclusão de `Conta` por FK para `PlatformBillingEligibilityCoverage`, tabela append-only. Nenhum comando operacional foi executado pelo worker. A revisão final de arquitetura e a execução operacional pertencem ao coordenador.

## Riscos e pendências

- A operação de criação de mensalidade permanece inconclusiva e requer decisão manual com evidência remota suficiente.
- O comando depende de manifesto revisado, credenciais de subconta persistidas e acesso GET válido ao Asaas. Divergências fecham o processo de forma segura.
- O passe automático de lag tem orçamento de 40 chamadas; issues restantes são reportadas para verificação posterior, sem polling agressivo.
- O teste de integração acima deixa os tenants gerados no banco `alusa_test` porque a trilha append-only impede o teardown existente. A tabela não foi alterada para contornar essa proteção.

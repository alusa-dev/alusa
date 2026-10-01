# Runbook: indisponibilidade e custo de observabilidade

## Falha de exportação

1. Confirme estado do projeto Sentry, quota/limites, DSN do ambiente, release e erro do SDK.
2. Compare eventos de teste controlado com logs stdout. O port compartilhado captura erro de sink sem propagar para request, job ou handler.
3. Não repita chamada de negócio nem grave telemetria em Postgres como fallback.
4. Restaure o SDK/configuração e valide uma ocorrência nova no ambiente correto; não inferir recuperação por configuração presente.

## Volume/custo alto

1. Separe volume por serviço, release, ambiente, sinal e evento antes de alterar sample rate.
2. Confira que não foi ativado `API_ACCESS_LOGS=1` em produção sem necessidade.
3. Reduza primeiro sampling de traces de sucesso e distributions amostradas. Preserve erros críticos e métricas de contagem de webhooks/jobs.
4. Verifique cardinalidade: nenhuma label deve conter conta, usuário, aluno, URL completa, mensagem de erro, pagamento ou identificador Asaas.
5. Confira Web Vitals em lote e sem escrita no banco; endpoint limita lote a seis itens e corpo a 8 KiB.
6. Registre o antes/depois de volume e custo. Não ajuste retenção de auditoria financeira para controlar custo de telemetria.

## Configuração por app

- Web: `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN`; `SENTRY_TRACES_SAMPLE_RATE`/`NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`.
- Admin: `ADMIN_SENTRY_DSN` e `NEXT_PUBLIC_ADMIN_SENTRY_DSN` independentes.
- Mobile: `EXPO_PUBLIC_SENTRY_DSN`, taxa de traces entre 0 e 1, API URL.
- Não inclua valores de secret em ticket, log ou saída de terminal.

## Dono e alerta

Defina owner e alerta após baseline: custo/volume de eventos, erros de envio, proporção de traces, cardinalidade e ausência de dados por ambiente. O workspace não contém credencial nem uma API conectada para configurar dashboards/alertas no Sentry; esse trabalho precisa ocorrer no projeto externo.

# Baseline e SLOs

Não configure limites numéricos até medir produção e alinhar impacto com Finance/Operações. Colete pelo menos um período representativo de calendário escolar e compare semana, fechamento financeiro e picos de matrícula.

## Indicadores a calibrar

| Área | Indicadores | Alerta candidato depois do baseline |
|---|---|---|
| Web/API | taxa 5xx, latência p50/p95/p99 por rota, indisponibilidade por região | degradação sustentada em rota crítica de matrícula/financeiro |
| Webhook financeiro | falha de processamento, retries, backlog e idade mais antiga, stuck, exauridos/DLQ | item crítico sem progresso acima do tempo de recuperação acordado |
| Job/outbox | duração, falha, quantidade processada e frequência da execução | execução ausente ou backlog acumulado |
| Asaas | erro/latência, circuit breaker e rate limit | erro persistente que ameace cobrança/reconciliação |
| Web/Mobile | Web Vitals por categoria de página, crashes e falhas de rede | piora sustentada em fluxo de responsável/aluno |
| Telemetria | quota, custo, rejeição de evento, ausência por release | aproximação do limite contratado ou buraco de cobertura |

## Como definir

1. Escolha serviço, janela, população e rota crítica; separe períodos de deploy e sazonalidade acadêmica.
2. Defina SLI a partir do resultado observável (ex.: evento financeiro persistido e processado dentro do prazo), não apenas span amostrado.
3. Escolha SLO, janela e error budget com o owner do fluxo.
4. Vincule alerta a runbook, responsável e janela sustentada para evitar alertas por flutuação curta.
5. Confira que consultas tenant-scoped continuam filtradas por `contaId` e não transformam a plataforma em um dashboard global acessível a admins escolares.

Os números e as regras finais devem ser registrados no projeto Sentry/monitoramento e neste documento depois da medição. Ainda não há baseline externo confirmado nesta entrega.

# Carga do mapa público de eventos

Este harness do k6 mede a leitura do mapa público e, em um modo separado, a reserva controlada de assentos. Ele **nunca chama `/checkout`**, não cria cobranças e não faz limpeza destrutiva. Os únicos arquivos do harness são `event-map-public.k6.js` e este guia; não há dependência npm.

## Proteções obrigatórias

O script falha antes de enviar qualquer requisição quando faltar uma confirmação ou o destino não passar pelas validações. Não desative nem contorne esses bloqueios.

- O destino precisa ser HTTPS, sem caminho adicional, e o hostname em `BASE_URL` precisa ser idêntico ao `ALLOWED_TEST_HOST` informado para aquela execução.
- Só são aceitos aliases Preview de branch no formato `alusa-web-git-<branch>-<team>.vercel.app` do projeto `alusa-web`, com allowlist exata. URLs imutáveis de deployment (por hash), aliases das branches `main`/`master`/`prod`/`production`, domínio customizado, localhost, domínio local, IP, porta ou host desconhecido são rejeitados pelo script.
- Todas as execuções exigem `TARGET_ENV=isolated-preview` e `NON_PRODUCTION_ACK=I_CONFIRM_ISOLATED_NON_PRODUCTION_PREVIEW`.
- O modo de reserva exige confirmação de fixture sintética exclusiva. Use somente mapa, assentos e conta sintéticos que possam ser consumidos pelo teste. O endpoint `/reserve` não chama pagamento; não exige configuração de sandbox financeiro.
- O modo de reserva precisa receber IDs de assentos criados previamente no deployment de teste. Não use IDs reais de produção.
- O script não falsifica `X-Forwarded-For`, `X-Real-IP`, `Forwarded` nem qualquer outro header de origem. Execute a partir do gerador real que deve ser contabilizado pelo rate limiter.
- Para um preview protegido, informe o segredo de bypass por variável de ambiente (`VERCEL_PROTECTION_BYPASS`). O segredo é enviado apenas no header de acesso ao preview e não deve ser colocado no repositório, no comando registrado no shell, em logs ou em relatórios compartilhados.
- Antes de iniciar, confira em **Vercel → Project Settings → Git** qual branch está configurada como produção. Confirme manualmente que o alias Preview escolhido aponta para outra branch, que o deployment e seu banco/credenciais são isolados, e que `BASE_URL`, `ALLOWED_TEST_HOST`, slug e fixture correspondem ao teste. O script bloqueia nomes convencionais de branch produtiva, mas não conhece a configuração de branch do projeto.

As confirmações são barreiras contra execução acidental; não substituem a revisão do alvo, a separação de dados ou a autorização operacional do ambiente.

## Perfis de leitura (`GET`)

Este perfil é somente de leitura do mapa: `steady` sobe progressivamente para 100, 300 e 600 VUs e mantém 600 por 15 minutos; `stress` sobe para 100, 300, 600, 800 e 1.000 VUs e mantém o pico por 10 minutos. Ambos fazem ramp-up, pausas de estabilização e ramp-down; cada VU espera entre 0,75 e 2,25 segundos entre as leituras. Os 600 VUs sustentados e 1.000 VUs de estresse são metas do gerador para o endpoint GET, **não** jornadas completas nem prova de capacidade para mais de 500 compradores de ponta a ponta.

O teste faz apenas `GET /api/public/event-maps/{PUBLIC_SLUG}`. O corpo das respostas é descartado para reduzir memória no gerador. Métricas próprias contam respostas `200`, `409`, `429`, `5xx` e outros status. A leitura considera apenas `200` uma resposta esperada.

```sh
k6 version
k6 run \
  --env MODE=read \
  --env PROFILE=steady \
  --env TARGET_ENV=isolated-preview \
  --env NON_PRODUCTION_ACK=I_CONFIRM_ISOLATED_NON_PRODUCTION_PREVIEW \
  --env BASE_URL=https://alusa-web-git-<branch-preview>-<team>.vercel.app \
  --env ALLOWED_TEST_HOST=alusa-web-git-<branch-preview>-<team>.vercel.app \
  --env PUBLIC_SLUG=<slug-sintetico-publicado> \
  scripts/load/event-map-public.k6.js
```

Após avaliar métricas e estabilidade do perfil sustentado, execute o estresse separadamente trocando `PROFILE=steady` por `PROFILE=stress`. O perfil de estresse dura aproximadamente 56 minutos e pode consumir recursos relevantes de aplicação, banco e gerador.

### Preview protegido

O header `x-vercel-protection-bypass` é enviado somente quando `VERCEL_PROTECTION_BYPASS` está definido; a Vercel recomenda esse header para ferramentas de teste. Carregue o segredo no ambiente seguro do gerador e execute o comando sem incluir o valor literal na linha de comando ou no histórico ([documentação de bypass para automação](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)):

```sh
export VERCEL_PROTECTION_BYPASS="${PREVIEW_BYPASS_SECRET}"
# Execute o mesmo comando k6 acima com --include-system-env-vars; não imprima nem compartilhe o segredo.
```

Use a URL exata do preview isolado e confirme que o alias não aponta para produção antes do teste. Em CI, prefira secret store e executor dedicado. O segredo de bypass não serve como autorização para testar um deployment produtivo.

## Reserva controlada (`POST /reserve`)

Cada VU envia exatamente uma requisição com `seatIds: [id]`. No modo `unique`, cada VU usa um ID exclusivo da lista pré-provisionada; o número de IDs precisa ser igual ou maior que `RESERVE_VUS`. No modo `contention`, todos disputam o mesmo assento e `200` ou `409` são respostas funcionais esperadas. O script não reutiliza IDs de forma automática e não tenta checkout.

```sh
k6 run \
  --env MODE=reserve \
  --env RESERVE_MODE=unique \
  --env RESERVE_VUS=3 \
  --env RESERVATION_SEAT_IDS=<id-1>,<id-2>,<id-3> \
  --env TARGET_ENV=isolated-preview \
  --env NON_PRODUCTION_ACK=I_CONFIRM_ISOLATED_NON_PRODUCTION_PREVIEW \
  --env SYNTHETIC_FIXTURE_ACK=I_CONFIRM_SYNTHETIC_EXCLUSIVE_FIXTURE \
  --env BASE_URL=https://alusa-web-git-<branch-preview>-<team>.vercel.app \
  --env ALLOWED_TEST_HOST=alusa-web-git-<branch-preview>-<team>.vercel.app \
  --env PUBLIC_SLUG=<slug-sintetico-publicado> \
  scripts/load/event-map-public.k6.js
```

Para contenção, use `RESERVE_MODE=contention`, `RESERVE_VUS=30` e `CONTENTION_SEAT_ID=<id-sintetico>`, removendo `RESERVATION_SEAT_IDS`. O threshold exige exatamente um `200`; os demais pedidos precisam retornar `409` para o ensaio passar. Faça cada modalidade em um fixture independente ou restaure o estado do fixture por um procedimento operacional não destrutivo antes da execução.

### Limite vigente e interpretação

Os limites estão definidos em [`public-event-map-rate-limit.ts`](../../apps/web/src/server/events/public-event-map-rate-limit.ts): reserva e checkout permitem 1.500 tentativas por subject em cinco minutos; status permite 15.000 consultas por subject e 60 por pedido no mesmo período; sincronização manual de pagamento permite 20 tentativas por subject em 15 minutos. O orçamento de status é uma configuração inicial e ainda precisa ser validado com polling e tráfego compartilhado no Preview; não representa comprovação de capacidade para mais de 500 jornadas completas. As rotas públicas usam IP de proxy somente se `TRUST_PROXY_HEADERS=true` e os headers confiáveis estiverem presentes. Caso contrário, elas usam um subject compartilhado fixo, sem derivar chaves do `User-Agent`/idioma. Por isso, IPs de egress distintos **só ajudam a separar subjects quando** proxy trust e headers confiáveis de IP do cliente da Vercel estão configurados; confirme a configuração efetiva antes de inferir o comportamento do limite.

No modo de contenção, `409` é esperado para assentos já reservados; `429` é contado e reprova o threshold. Com um único subject, mais de 1.500 reservas em cinco minutos atingem o limite. O modo de reserva deste harness é um exercício controlado de endpoint, não uma jornada de compra completa.

Para exercitar mais de 500 compradores em jornadas completas, execute um teste posterior e separado no preview: primeiro concorrência de reservas controlada, depois checkout e pagamento em sandbox, com inventário e dados sintéticos. O orçamento atual permite até 1.500 reservas ou checkouts por subject em cinco minutos e até 15.000 consultas de status por subject, além de 60 por pedido; a capacidade de escrita depende também do IP confiável, Redis, banco e integração de pagamento. Não presuma que dividir o gerador entre egressos elimina o rate limit. Não injete IPs falsos nem reduza/desabilite a proteção em produção. O GET de 600/1.000 VUs e o POST de reserva controlada não provam, isolados ou somados, capacidade para mais de 500 compras completas.

As reservas de teste criam holds reais no banco do preview. Não há rotina de limpeza automática neste harness. Deixe o fluxo normal expirar e liberar os holds, e confirme depois no preview que os assentos voltaram ao estado esperado. Não rode outro ensaio com o mesmo fixture até a liberação ser confirmada.

## Critérios de avaliação

Os critérios de validação são: GET `p95 < 2.000 ms` e `p99 < 4.000 ms`; POST `/reserve` `p95 < 2.000 ms` e `p99 < 5.000 ms`; zero respostas inesperadas, `429` ou `5xx`. O k6 marca a execução como falha se qualquer uma ocorrer ou se os thresholds de latência não forem atendidos. No perfil de leitura, um `404` pode indicar slug/preview incorreto, não capacidade.

Para reserva `unique`, espere `200` em todos os pedidos dentro do limite de rate; `409` sugere fixture repetido, assento indisponível ou corrida que precisa ser investigada. Para contenção, o threshold exige exatamente uma aquisição (`200`) e as demais como conflito (`409`); qualquer `429` reprova o ensaio. Correlacione os resultados com métricas do deployment, pool/conexões e latência do banco. Execute primeiro uma leitura curta de validação e aumente o perfil somente depois de confirmar destino e telemetria.

## Limites do resultado

`600` e `1.000` são metas de VUs para o GET de leitura, não capacidade já demonstrada para mais de 500 compradores completos. VUs não equivalem a compradores ativos nem a RPS fixo: o think time, o custo do mapa, a rede, o gerador, o cache, a região e o banco alteram a taxa efetiva. O POST `/reserve` é apenas um ensaio controlado da reserva; checkout concorrente, pagamento na sandbox, webhooks e jornada completa precisam de testes posteriores distintos. Um teste bem-sucedido em preview não prova capacidade de produção nem substitui E2E, observabilidade, revisão de pool/índices e ensaio progressivo acompanhado pela operação.

Referências usadas para a configuração k6: [ramping VUs e estágios](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/ramping-vus/) e [thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/).

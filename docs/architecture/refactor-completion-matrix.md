# Matriz de conclusão da refatoração arquitetural

Atualizada em 17 de setembro de 2026. Este documento diferencia implementação
no código de evidência que depende de infraestrutura, credenciais ou operação.

## Snapshot desta rodada

- A auditoria estática das APIs encontrou 519 rotas (492 no web e 27 no admin),
  com 0 imports diretos de Prisma e
  nenhum caminho direto novo desde o baseline de 166.
- A auditoria de tamanho encontrou 0 handlers acima de 300 linhas; o limite é
  mantido pelo gate `pnpm audit:route-sizes`.
- A auditoria HTTP analisou 520 rotas, encontrou 0 violações bloqueantes de
  método/status e registra revisões não bloqueantes para comandos legados cuja
  conclusão síncrona usa `200` deliberadamente.
- As famílias user-facing tenant-scoped auditadas nesta rodada — vendas,
  dashboard, conta, descontos, colaboradores, professores, notificações,
  KYC, storage/avatar, busca e gestão de usuários — usam
  `resolveTenantSession` ou `resolveTenantScope` como autoridade de tenant.
- Restam 36 handlers com acesso direto à sessão. Eles estão restritos a
  Admin global, autenticação/sessão do próprio usuário, endpoints de conta
  deliberadamente bloqueados, consentimento e health; não são equivalentes a
  rotas comuns que escolhem `contaId` pelo cliente.
- A suíte web completa passou em 327/327 arquivos e 1.561/1.561 testes; o
  workspace completo também passou em Admin (4/4 arquivos, 7/7 testes), Mobile
  (11/11 suítes, 45/45 testes) e demais packages.
- A suíte completa de `@alusa/finance` passou em 225/225 arquivos e
  1.804/1.804 testes, com 1 teste explicitamente ignorado pelo próprio pacote.
- O fluxo production-like de criação/agrupamento financeiro passou em 13/13
  testes e as regras de domínio de matrícula passaram em 22/22, incluindo o
  contrato seguro de códigos HTTP para transições inválidas, estados terminais
  e datas inconsistentes.
- O teste de isolamento real de `PasswordChangeOtp` foi executado com worker
  único, e o papel local `alusa_app` foi preparado sem `SUPERUSER`/`BYPASSRLS`;
  a validação Conta A/B continua pendente em staging com credenciais
  equivalentes às de produção.
- Nenhuma alteração foi commitada ou enviada ao remoto.

| Fase | Estado atual | Evidência local | Pendência objetiva |
| --- | --- | --- | --- |
| 0 — baseline | Implementada | Inventário de rotas, packages, CI, migrations e boundaries | Nenhuma de código; manter inventário após cada lote |
| 1 — RLS | Implementada no código e validada localmente | `pnpm security:check`; migration de `PasswordChangeOtp`; serviço de OTP usando `runWithTenant`; teste com role `NOBYPASSRLS`; banco vazio migrado | Repetir com a role real de produção e `DATABASE_RLS_URL` |
| 2 — tenant authority | Implementada nas famílias críticas e nas APIs tenant-scoped auditadas | `withTenantSession`, `resolveTenantSession`, `resolveTenantScope`, `runWithTenant`, testes adversariais e auditoria de DTOs | Revisão operacional de jobs/admin/webhooks conforme novos consumidores |
| 3 — CI | Implementada | CI executa segurança, cron, DTOs, boundary, testes, typecheck e build | Confirmar execução no provedor Git após o primeiro PR |
| 4 — cobranças | Implementada incrementalmente | Characterization/unit tests; `/api/cobrancas/[id]` com helpers/use cases extraídos | Ampliar somente quando houver nova mudança funcional |
| 5 — rotas críticas | Implementada | 519 rotas auditadas; 0 imports diretos de Prisma, 0 imports diretos de Asaas, 0 retornos inseguros, 0 rotas Prisma sem DTO/schema de entrada e 0 handlers acima de 300 linhas | Manter auditoria no CI e retirar gateways de compatibilidade em mudanças funcionais futuras |
| 6 — financeiro | Implementada nos boundaries | Finance sem import genérico de `@alusa/lib`; testes unitários completos; timeout provider-aware | Sandbox Asaas, webhook HMAC e reconciliação real |
| 7 — `packages/lib` | Convergência implementada | Subpath exports; nenhum import do barrel no runtime de `apps/web`; gate `audit:lib-boundaries` | Remoções maiores exigem telemetria de uso; barrel continua por compatibilidade |
| 8 — banco | Integridade preservada e migrations verificadas | 301 migrations aplicadas em banco vazio e banco de teste sem pendências | Auditoria de unicidades Asaas com dados representativos de produção |
| 9 — Admin | Boundary endurecido | `apps/admin`, APIs Web e autenticação administrativa preservados e testados | Cutover/remoção somente após telemetria de consumidores |
| 10 — Mobile | Padrão de sessão implementado | SecureStore, bearer/refresh, `expo-doctor` 20/20, typecheck, lint sem erros e 45 testes aprovados | E2E em dispositivo/emulador |
| 11 — legado | Limpeza segura parcial | Artefatos temporários removidos; caminhos canônicos protegidos por gates | Medir uso, migrar consumidores e remover legado comprovadamente sem uso |

## Gates executados nesta revisão

- `pnpm security:check`
- `pnpm validate:cron-config`
- `pnpm audit:dtos`
- `pnpm audit:lib-boundaries`
- `pnpm audit:route-inventory -- --write`
- `pnpm audit:route-boundaries`
- `pnpm audit:route-sizes`
- `pnpm audit:api-canonicalization`
- `pnpm audit:http-contracts`
- validação dos handlers tenant-scoped convergidos nesta rodada
- 29 testes de matrícula e 33 testes unitários das famílias alteradas
- `git diff --check`
- `pnpm --filter @alusa/mobile run doctor`
- typecheck Web e monorepo
- `pnpm lint:check` (0 erros; 1.276 warnings legados no monorepo, 930 na Web,
  com baseline e ratchet por regra)
- testes unitários Web, Finance e Mobile
- `pnpm test` (327 arquivos Web / 1.561 testes, além dos packages, Admin e Mobile)
- `pnpm --filter @alusa/finance test:unit` (225 arquivos / 1.804 testes; 1 skipped)
- `pnpm build` do monorepo (Web e Admin compilados)
- E2E crítico
- wizard de aluno: 7/7 no Chromium em modo CI
- E2E production-like em `next start`: cadastro público 2/2, gate crítico 18/18,
  editor de mapas 2/2, cenários de colaborador/webhook 2/2, fluxo financeiro
  13/13 e regras de matrícula 22/22
- migrations em banco vazio
- fluxos de autenticação/onboarding atualizados em E2E offline

## Observação sobre a suíte E2E total

A execução integral atual encontrou 240 testes. O runner usa um worker único
em qualquer ambiente, `next start` com build isolado `.next-playwright`, um
papel RLS local sem `SUPERUSER`/`BYPASSRLS` e um Redis REST explicitamente
fornecido. O seed genérico cria uma conta de billing em trial válido, evitando
bloqueios comerciais acidentais. Cadastro público, contratos críticos, wizard
de aluno, editor de mapas e os cenários corrigidos de colaborador/webhook
passaram isoladamente nos números registrados acima.

A execução ampla ainda não pode ser declarada verde: encontrou fixtures
legados de matrícula/financeiro, contratos de resposta antigos e cenários que
exigem dados representativos ou credenciais Asaas. O runner foi interrompido
após confirmar esses grupos para não transformar falhas em retries/esperas
artificiais. A suíte crítica usada no gate continua sendo a referência de
merge; a suíte total precisa de uma rodada dedicada de estabilização antes do
aceite global.

O particionamento equivalente ao CI (`--shard=1/4`, 61 testes) havia sido
tentado no servidor de desenvolvimento e sofreu reinício por memória. O runner
production-like agora usa `next start`, heap configurável, um worker único e
build isolado. O teste legado `e2e/alunos.spec.ts` foi migrado para o fluxo
canônico de `/alunos` e passou isoladamente em 1/1. A parte antiga de API de
`e2e/asaas.integration.spec.ts` permanece opt-in (`E2E_ASAAS_LEGACY_API=true`)
e exige sandbox; o teste de webhook sem assinatura usa a superfície atual e
passa com rejeição estrita em production-like.

Validações adicionais concluídas nesta rodada: regras de matrícula em 22/22,
hard-block de KYC em 1/1, hardening de eventos em 2/2 e layout de detalhes de
contrato em 1/1. Esses números
representam execuções isoladas com banco de teste local; não substituem a
validação dos cenários que dependem de sandbox Asaas, HMAC real, emulador
Mobile ou observabilidade de produção.

Nesta rodada, o fluxo completo do wizard de alunos passou em 7/7 no Chromium,
cobrindo maior de idade, menor de idade, responsável novo/existente, validações
condicionais e dinâmica de etapas. A validação por etapas usa uma variante
parcial do mesmo schema canônico; a submissão continua protegida pelo schema
completo. O vínculo de responsável existente mantém apenas o ID no payload,
evitando copiar CPF mascarado para o objeto de criação.

Os fluxos de cadastro e onboarding também foram alinhados ao contrato atual:
cadastro público, confirmação de e-mail, criação de ADMIN, duplicidade de
e-mail e proteção da tela de login autenticada. O Playwright mantém Resend
desabilitado e o provider financeiro em mock durante E2E; a entrega externa e
o preflight real continuam cobertos separadamente por testes de integração e
operação controlada.

Nesta rodada também foram validados: ciclo de vida de aluno/responsável em 5/5,
convite duplicado com resposta HTTP 409 em 2/2 testes unitários e 1/1 E2E,
cadastro/disponibilidade do primeiro usuário em 11/11 testes unitários, além
dos lotes de autenticação, cobranças, financeiro operacional, integrações,
wizard de aluno e onboarding de e-mail já listados no histórico desta matriz.
O teardown do ciclo de vida foi alinhado às FKs reais de `CustomerPayer`, e os
fixtures acadêmicos passaram a usar o seed canônico com billing em trial, sem
alterar a política comercial de produção.

O endpoint de convite também passou a normalizar a capitalização ao mapear
duplicidade para 409, evitando que uma mensagem iniciada por “Já” caísse no
tratamento genérico 500. A correção é coberta por teste unitário e E2E.

O Mobile também foi alinhado aos patches recomendados pelo Expo SDK instalado,
sem mudança de major/minor: `expo-doctor` passou 20/20, o typecheck passou, o
lint não apresentou erros e a suíte Jest passou 45/45.
O CI principal também executa `expo-doctor` como gate de compatibilidade do
SDK; o E2E nativo permanece fora do runner Ubuntu por depender de emulador ou
dispositivo.

O critério global só deve ser marcado como concluído depois que as pendências
objetivas acima tiverem evidência correspondente. Nenhuma remoção de legado,
alteração de unicidade ou cutover administrativo deve ser inferida apenas por
ausência de referências no código.

# Alusa Admin — Fases 0 e 1

## Objetivo

Preparar e endurecer o backoffice administrativo atual sem alterar URLs, banco
ou fluxo de uso das escolas. A separação em `apps/admin` pertence às fases
seguintes.

## Baseline e inventário

Implementação administrativa atual:

- páginas: `apps/web/app/developer/**`;
- autenticação: `apps/web/features/global-admin/auth/**`;
- domínio de suporte: `apps/web/features/support/**`;
- APIs administrativas: `/api/developer/**` e `/api/global-admin/auth/**`;
- entidade persistida: `SupportUser`;
- auditoria: `SupportAuditLog`;
- provisionamento explícito: `pnpm support:upsert-admin`.

Fluxos críticos preservados:

- login e logout da Central de Suporte;
- busca cross-tenant administrativa;
- leitura de contas, usuários, alunos, responsáveis e matrículas;
- consultas e ações financeiras administrativas;
- leitura e replay de webhooks;
- casos, notas e auditoria.

Antes de cada deploy, executar na raiz:

```bash
pnpm --filter @alusa/web typecheck
pnpm --filter @alusa/web test:unit
pnpm --filter @alusa/web build
pnpm security:check
```

Em ambientes com banco de teste, o comando de testes deve ser executado com
`.env.test`; ele valida que o `DATABASE_URL` contém `alusa_test`.

## Contratos de compatibilidade

- `/developer` permanece como URL oficial da Central durante as fases 0 e 1.
- `SupportUser` e os enums atuais permanecem compatíveis.
- Nenhuma rota administrativa importa ou depende de sessão escolar.
- O login nunca cria usuário e nunca redefine senha.
- A autorização administrativa falha fechada quando a sessão, usuário, role ou
  expiração não puderem ser validados.
- O `NEXTAUTH_SECRET` não pode assinar ou validar sessão administrativa.
- O rate limit administrativo é distribuído quando Redis/Upstash está
  configurado e fail-closed em produção quando o backend não está disponível.

## Hardening implementado

- removido auto-provisionamento por `GLOBAL_ADMIN_USERNAME/PASSWORD`;
- removida redefinição de `passwordHash` por credencial de ambiente;
- removido fallback de `GLOBAL_ADMIN_SESSION_SECRET` para `NEXTAUTH_SECRET`;
- role e identidade persistida passaram a ser obrigatórias no token;
- status, role, username e expiração de `BREAK_GLASS` são revalidados no banco
  em cada requisição;
- login e APIs administrativas usam `authRateLimitAsync`;
- leituras de páginas administrativas e acessos de API geram auditoria;
- erros de autenticação não devolvem mensagens internas ao cliente;
- variáveis de usuário/senha global foram removidas do `.env.example`.

## Rollback

O rollback da aplicação pode ser feito para o deploy anterior, mas os usuários
administrativos devem continuar provisionados no banco pelo script explícito.
Não remover `SupportUser` nem alterar migrations nesta fase.

## Critério de conclusão

As fases 0 e 1 estão concluídas quando os testes administrativos, typecheck,
build e verificações de segurança passam em ambiente de teste, e um usuário
persistido consegue acessar todos os módulos que já utilizava.

## Verificação local desta implementação

- typecheck do `apps/web`: aprovado;
- lint dos arquivos alterados: aprovado;
- testes administrativos e de segurança direcionados: aprovados;
- registry de proteção de rotas: aprovado;
- `pnpm security:check`: ainda reporta tabelas tenant-scoped sem RLS detectável
  em migrations existentes fora do escopo desta fase; esse baseline fica
  registrado para a trilha de segurança/migrations e não foi mascarado.

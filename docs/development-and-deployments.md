# Desenvolvimento e deploys da Alusa

## Visão geral

A Alusa é um monorepo pnpm/Turborepo com dois projetos independentes na Vercel:

| Projeto | Diretório raiz na Vercel | Pacote | Responsabilidade |
| --- | --- | --- | --- |
| `alusa-web` | `apps/web` | `@alusa/web` | Site público e sistema principal |
| `alusa-admin` | `apps/admin` | `@alusa/admin` | Administração interna do desenvolvedor |

Os dois projetos acompanham a branch `main`, mas cada um possui build, deployment,
domínio e variáveis de ambiente próprios. Um push na `main` pode iniciar dois
deployments; os Ignored Build Steps abaixo evitam executar um build quando o grafo
de dependências comprova que o projeto não foi afetado.

## Builds da Vercel

### `alusa-web`

O build instala o workspace, gera o Prisma, compila as dependências necessárias
e executa o build Webpack do Next.js:

```text
cd ../.. && pnpm prisma:generate &&
NODE_OPTIONS=--max-old-space-size=4096
pnpm exec turbo run build --filter=@alusa/web^... &&
pnpm --dir apps/web build:webpack
```

### `alusa-admin`

O build instala o workspace, gera o Prisma e compila o app e suas dependências:

```text
cd ../.. && pnpm prisma:generate &&
pnpm exec turbo run build --filter=@alusa/admin
```

O `--force` não é usado: o cache do Turbo deve ser aproveitado quando o hash do
pacote não mudou.

## Ignored Build Step

Cada projeto usa o script compartilhado:

```text
node ../../scripts/vercel-ignore-build.mjs @alusa/web
node ../../scripts/vercel-ignore-build.mjs @alusa/admin
```

Na Vercel, código de saída `0` ignora o build e código `1` continua o build.
O script compartilhado chama `turbo query affected`, usando os SHAs fornecidos
pela Vercel:

1. Usa `VERCEL_GIT_PREVIOUS_SHA`; no primeiro deployment, tenta `HEAD^` como
   fallback.
2. Executa `turbo query affected` para considerar o app e suas dependências
   internas declaradas no `package.json`.
3. Usa `globalDependencies` no `turbo.json` para que Prisma, lockfile,
   workspace, Turbo e arquivos operacionais invalidem os dois projetos.
4. Ignora somente quando o Turbo confirma que o pacote não foi afetado.
5. Em qualquer erro de análise, mantém o build por segurança.

Essa estratégia é deliberadamente conservadora: um build extra é preferível a
deixar produção usando um artefato incompatível com uma alteração compartilhada.

## Matriz de decisão

| Alteração | `alusa-web` | `alusa-admin` |
| --- | ---: | ---: |
| `apps/web/**` | Build | Ignora |
| `apps/admin/**` | Ignora | Build |
| Pacote interno usado pelo app | Build | Build quando parte da cadeia do admin |
| `prisma/schema.prisma` ou `prisma/migrations/**` | Build | Build |
| `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json` | Build | Build |
| Configuração do próprio projeto Vercel/Next | Build | Build no projeto correspondente |
| Documentação sem impacto no grafo | Ignora | Ignora |

Alterações em `packages/**` são avaliadas pelo grafo do Turbo. Como o Web usa uma
cadeia ampla de pacotes internos, mudanças relevantes para ele continuam
disparando seu build; o Admin só é incluído quando sua cadeia é afetada.

## Como validar localmente

O script retorna `0` para ignorar e `1` para continuar o build:

```bash
VERCEL_GIT_PREVIOUS_SHA=<sha-anterior> \
  node scripts/vercel-ignore-build.mjs @alusa/web

VERCEL_GIT_PREVIOUS_SHA=<sha-anterior> \
  node scripts/vercel-ignore-build.mjs @alusa/admin
```

Para validar a detecção diretamente pelo Turbo:

```bash
pnpm exec turbo query affected \
  --base=<sha-anterior> \
  --head=HEAD \
  --packages=@alusa/web \
  --exit-code
```

O comando acima retorna `1` quando o pacote foi afetado e `0` quando não foi.

Antes de publicar mudanças de build, execute pelo menos:

```bash
pnpm --filter @alusa/web typecheck
pnpm --filter @alusa/admin typecheck
git diff --check
```

Depois do push, confirme separadamente os dois deployments na Vercel e valide
os domínios públicos. A presença de deployments vermelhos antigos no histórico
não significa que o alias de produção esteja apontando para eles.

## Operação e segurança

- Não colocar tokens da Vercel, Sentry, banco, Asaas ou Stripe em commits.
- Manter `contaId` e as regras de isolamento multi-tenant intactas durante
  alterações no sistema.
- Alterações em Prisma devem continuar gerando o client antes do build.
- O Sentry do sistema está restrito ao ambiente `production`; erros locais e
  previews não devem ser enviados ao projeto de produção.
- Em caso de falha de build, investigar os logs antes de iniciar novos deploys
  em sequência.

# Fluxo profissional: ajuste local, deploy e correcoes

Este documento orienta agentes e IAs que forem atuar no projeto Alusa. O objetivo e manter um fluxo previsivel entre desenvolvimento local, banco Neon e deploy Vercel, evitando retrabalho, projetos duplicados e correcoes aplicadas no lugar errado.

## Fonte de verdade

O deploy oficial deste repositorio e sempre o projeto Vercel `alusa-web`.

Configuracao esperada:

- Vercel team: `team_Etz080or5wfUhve3FPorySS3`
- Vercel project: `alusa-web`
- Vercel project id: `prj_0YbnfGWO5vU1Mx3mdK592nkyk3Qk`
- Root Directory: `apps/web`
- Framework Preset: `Next.js`
- Node.js Version: `20.x`
- Install Command: `cd ../.. && pnpm install --frozen-lockfile`
- Build Command: `cd ../.. && pnpm prisma:generate && pnpm -r run build`
- Output Directory: `Next.js default`

O arquivo local `.vercel/project.json` deve apontar para `alusa-web`:

```json
{"projectId":"prj_0YbnfGWO5vU1Mx3mdK592nkyk3Qk","orgId":"team_Etz080or5wfUhve3FPorySS3","projectName":"alusa-web"}
```

Nao use, nao recrie e nao faca deploy no projeto Vercel `alusa`. Esse projeto era duplicado, causava builds paralelos e falhas como "No Output Directory named public". Ele foi removido para consolidar o ambiente.

## Banco Neon

O banco gerenciado e Neon Postgres.

Dados nao sensiveis conhecidos:

- Neon project: `Alusa`
- Neon project id: `polished-glitter-40606095`
- Branch principal: `production`
- Branch id: `br-tiny-silence-acg489yn`
- Database: `neondb`
- Regiao: `aws-sa-east-1`

Use o MCP do Neon para consultar projeto, branch, computes e schema. Nunca imprima connection strings, tokens, secrets ou variaveis descriptografadas em respostas finais, logs ou commits.

Consultas seguras para contexto:

```sql
select current_database() as database, current_user as role, version() as version;
```

## Regra de ouro para agentes

Antes de corrigir qualquer problema de deploy:

1. Confira o status local:

```bash
git status --short --branch
```

2. Proteja alteracoes existentes que nao foram feitas por voce. Nao reverta arquivos modificados por outro agente ou pelo usuario.

3. Confirme que o projeto Vercel local e `alusa-web`:

```bash
cat .vercel/project.json
pnpm exec vercel project inspect alusa-web --scope alusa
```

4. Se aparecer um projeto chamado `alusa`, trate como erro operacional. O projeto correto e `alusa-web`.

## Fluxo local recomendado

Instale dependencias com a versao declarada no repositorio:

```bash
pnpm install --frozen-lockfile
```

Gere o Prisma Client:

```bash
pnpm prisma:generate
```

Para desenvolvimento local:

```bash
pnpm dev:web
```

Para validar o build completo antes do push:

```bash
pnpm -r run build
```

Para validar apenas o app web com as dependencias do workspace:

```bash
pnpm --filter @alusa/web... build
```

Observacoes:

- O build do `@alusa/web` ja roda `prisma generate --schema=../../prisma/schema.prisma`.
- Avisos de rotas dinamicas do Next durante prerender podem aparecer, mas o criterio final e o exit code do build.
- O projeto usa `pnpm@10.0.0` no `packageManager` e Node `20.x`.

## Fluxo de deploy

O deploy de GitHub deve ocorrer pelo projeto `alusa-web`.

Depois de fazer push, valide pelo MCP ou CLI da Vercel:

```bash
pnpm exec vercel project inspect alusa-web --scope alusa
pnpm exec vercel ls alusa-web --scope alusa
```

Com MCP da Vercel, valide:

- projeto `prj_0YbnfGWO5vU1Mx3mdK592nkyk3Qk`
- ultimo deployment `READY`
- commit SHA esperado
- framework `nextjs`
- branch correta

Teste uma rota publica do preview:

```bash
curl -I https://<preview-url>/auth/login
```

Resposta esperada: `200 OK`.

Para rotas autenticadas como `/dashboard`, redirecionamento para login e esperado quando nao ha sessao. Um `500` deve ser investigado como problema de runtime/env.

## Diagnostico de falhas de build na Vercel

Use primeiro o MCP da Vercel:

1. Buscar o deployment falho.
2. Ler os build logs.
3. Confirmar qual projeto recebeu o deploy.
4. Confirmar commit, branch e root directory.
5. Comparar a falha com o build local.

Falha conhecida ja corrigida:

- Sintoma: `No Output Directory named "public" found after the Build completed`.
- Causa: deploy indo para projeto duplicado `alusa` com preset `Other` e root `.`.
- Correcao profissional: remover o projeto duplicado e manter apenas `alusa-web` com root `apps/web` e preset Next.js.

Falhas comuns e verificacoes:

- `No Next.js version detected`: o projeto esta apontando para root errado. Deve ser `apps/web`.
- `NEXTAUTH_SECRET ausente`: verificar variaveis no projeto `alusa-web`; nao inserir placeholder em runtime.
- Prisma Client incompatível: rodar `pnpm prisma:generate` e confirmar que o build executa o script do app web.
- Runtime 500 apos build `READY`: comparar env vars do projeto correto, verificar logs de runtime e testar rota publica antes de rotas autenticadas.

## Variaveis de ambiente

As variaveis oficiais devem estar no projeto Vercel `alusa-web` para `production` e `preview`.

Nunca copie valores para documentação, issue, PR ou resposta final. Liste somente chaves quando necessario.

Chaves esperadas, conforme ambiente atual:

- `DATABASE_URL`
- `DIRECT_URL`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `NEXT_PUBLIC_APP_URL`
- `ENCRYPTION_KEY`
- `RESEND_API_KEY`
- `ASAAS_*`
- `FIN_WEBHOOK_*`
- `R2_*`
- `GLOBAL_ADMIN_*`

Para auditar apenas nomes de variaveis:

```bash
pnpm exec vercel env ls --scope alusa
```

Ou via API/MCP, sempre omitindo valores.

## Correcoes com banco de dados

Para alteracoes de schema:

1. Leia `prisma/schema.prisma`.
2. Use branch temporaria no Neon quando a migracao tiver risco.
3. Gere e revise SQL antes de aplicar em production.
4. Aplique somente depois de validar impacto.
5. Rode verificacoes com Prisma e testes relevantes.

Nunca rode migracoes destrutivas diretamente sem revisar dados afetados. Nunca use banco de producao como banco de teste.

## Commits e higiene de Git

Antes de editar:

```bash
git status --short --branch
```

Se houver alteracoes nao relacionadas, ignore-as e nao reverta. Commits devem conter somente arquivos do escopo da correcao.

Fluxo recomendado:

```bash
git diff --check
pnpm --filter @alusa/web... build
git add <arquivos-do-escopo>
git commit -m "fix: descricao objetiva"
git push
```

Ao finalizar, reporte:

- arquivos alterados
- comandos de validacao executados
- deployment Vercel validado
- pendencias ou riscos residuais

## Checklist final

Antes de encerrar uma correcao de deploy:

- `.vercel/project.json` aponta para `alusa-web`.
- Nao existe `vercel.json` raiz sobrescrevendo root/framework sem necessidade.
- `pnpm --filter @alusa/web... build` passa localmente.
- O deploy no projeto `alusa-web` esta `READY`.
- `/auth/login` responde `200 OK` no preview.
- Nenhum secret foi impresso ou commitado.
- Alteracoes nao relacionadas do usuario foram preservadas.


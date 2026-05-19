---
applyTo: 'apps/site/**,package.json,pnpm-lock.yaml'
---

## Regra: site publico (`apps/site`) exige deploy manual

O projeto Vercel `alusa-site` nao esta conectado ao Git. Portanto, push em `main` nao publica automaticamente em `https://alusa.app`.

Quando alterar `apps/site` ou configuracoes/dependencias que afetem o site publico:

1. Validar antes de concluir:

```bash
pnpm --filter @alusa/site typecheck
pnpm --filter @alusa/site lint
```

2. Commitar somente o escopo do site e dependencias/configuracoes relacionadas.

Nao incluir alteracoes alheias ao site, por exemplo arquivos de `apps/web` ja modificados no worktree, salvo pedido explicito.

Nao commitar artefatos gerados:

- `apps/site/.next/`
- `apps/site/.turbo/`
- `apps/site/node_modules/`
- `apps/site/.vercel/`
- `apps/site/tsconfig.tsbuildinfo`
- `apps/site/package-lock.json`

3. Enviar para `main`:

```bash
git push origin HEAD:main
```

4. Fazer deploy manual de producao:

```bash
cd apps/site
vercel --prod --yes --force
```

5. Confirmar o deploy:

```bash
vercel inspect <deployment-url>
```

O deployment deve estar `Ready` e com aliases:

- `https://alusa.app`
- `https://alusa-site.vercel.app`

6. Verificar producao:

```bash
curl -L -s https://alusa.app | rg "Gestao escolar|Sua escola nao deveria|Alusa"
```

Se `alusa.app` nao refletir a mudanca apos push em `main`, a primeira hipotese deve ser falta de Git integration no Vercel. Execute o deploy manual antes de investigar cache.

## Configuracao Vercel atual

Manter em `apps/site/vercel.json`:

```json
{
  "installCommand": "npm install --ignore-scripts",
  "buildCommand": "npm run build",
  "framework": "nextjs"
}
```

Nao trocar para `pnpm install` enquanto a Vercel estiver usando Node 24.x nesse projeto: ja houve falha remota `ERR_PNPM_META_FETCH_FAIL` / `Value of "this" must be of type URLSearchParams`.

Nao restaurar `outputFileTracingRoot` em `apps/site/next.config.mjs` sem testar deploy remoto: com o projeto standalone atual, isso gerou erro de path duplicado para `.next/routes-manifest.json`.

# Runbook de deploy de produção

Este runbook define o fluxo de publicação da Alusa. A produção é multi-tenant e
possui integrações financeiras; a validação e o acompanhamento de deploy devem
ser proporcionais à mudança e ao seu risco. Um push, por si só, não confirma
publicação.

## Regras obrigatórias

- Para mudanças comuns de baixo risco, o caminho padrão é validar localmente o
  escopo afetado, revisar o diff e então commitar e enviar diretamente para
  `main`, se as proteções existentes permitirem.
- Não mascarar resultados nem pular testes específicos como atalho. No fast
  path, um check local direcionado é uma ferramenta para encontrar bugs, não um
  gate burocrático: corrigir antes do push se revelar falha relevante
  reproduzível ou se o diff mostrar bug/regressão clara.
- Não esperar full suite, review humano ou CI remoto flaky/não relacionado para
  publicar no fast path. A proteção classic atualmente verificada em `main`
  permite push direto sem PR, approval ou status check obrigatório. Mantém
  admins abrangidos, histórico linear obrigatório, proibição de force push e
  exclusão, e resolução de conversas obrigatória.
- PR e aprovação humana não são caminho nem gate do fast path. Se o GitHub
  rejeitar um push no futuro, verificar se a configuração mudou e identificar a
  regra efetiva; não contornar força linearidade, force push, exclusão ou outros
  controles de integridade. O deploy automático depende da integração GitHub/
  Vercel ativa.
- Não executar migrations destrutivas junto com uma publicação comum.
- Não usar banco de produção em testes, build local ou seed.
- Não colocar tokens da Vercel, Asaas ou banco em commits, logs ou client.
- Em alterações financeiras, validar comportamento somente por meios seguros,
  escopados, auditáveis e idempotentes.

## 1. Fast path: mudança comum de baixo risco

Use quando a mudança for localizada e não afetar autenticação, isolamento
`contaId`, regras financeiras, webhooks, schema/migrations, build/CI ou outros
fluxos críticos. Ajuste a validação ao diff; não execute a full suite por padrão.

Quando o usuário pedir explicitamente o fast path direto para produção, começar
na branch `main`, com working tree limpa ou com alterações existentes
identificadas e preservadas com segurança. Antes de editar, confirmar branch e
estado do checkout:

```bash
git branch --show-current
git status --short
```

Se a tarefa já estiver em uma branch de feature, não enviar esse HEAD para
`main` nem fazer merge/cherry-pick implícito. Manter o fluxo explícito e seguro;
solicitar orientação para continuar em `main` ou concluir pelo fluxo de branch
e PR configurado.

1. Use checks locais direcionados ao código alterado (por exemplo,
   lint/typecheck do workspace ou teste unitário da feature) para procurar
   bugs. No fast path, seus resultados não são um gate burocrático: investigar
   falha relevante e reproduzi-la; corrigir antes do push se confirmada. Falha
   claramente flaky/não relacionada não exige aguardar full suite/CI remoto.
   Para mudança só de documentação, revisar o diff e executar `git diff --check`.
2. Revise o diff e confirme que não há arquivos, dados ou segredos indevidos:

   ```bash
   git diff --check
   git status --short
   git diff
   ```

3. Após corrigir bugs claros encontrados na revisão ou nos checks, faça commit
   e push:

   ```bash
   git add <arquivos-revisados>
   git commit -m "<mensagem objetiva>"
   git push origin main
   ```

   A proteção classic atualmente verificada permite este push direto. Se o
   GitHub rejeitar por uma mudança futura de configuração, inspecione a regra
   efetiva antes de prosseguir. Nunca faça force push, exclua `main` ou altere
   settings sem autorização explícita.
4. Assim que o push terminar, localize a implantação criada para o SHA enviado
   no dashboard Vercel do projeto. Acompanhe os estados de fila/build até
   `Ready` ou falha. Não encerrar o acompanhamento em `Queued`, `Building` ou
   `Error`; em falha, inspecionar logs, corrigir a causa e repetir a validação
   antes de um novo push.
5. Quando estiver `Ready`, confira que o commit/SHA da implantação corresponde
   ao enviado e que os aliases de produção esperados apontam para ela. Registre
   SHA, ID/URL do deployment, estado e aliases. Só então declarar deploy
   concluído.

O acompanhamento pode ser feito pelo dashboard Vercel e pelo status de
implantação associado ao commit no GitHub, quando essa integração estiver
ativa. Um check de CI não substitui a confirmação de `Ready`, SHA e aliases.

## 2. Mudanças materiais ou de risco elevado

Aumente as salvaguardas conforme o risco real, não para cumprir cerimônia.
Considere de risco elevado mudanças em tenancy/autorização, financeiro,
Asaas/webhooks/reconciliação, auth, schema/migrations/backfills, build/CI ou
fluxos críticos acadêmicos. Preserve validações de isolamento `contaId`,
autorização, idempotência e efeitos de webhook/financeiro quando aplicáveis.
Siga os contratos especialistas aplicáveis. Não aguarde full suite, revisão
humana ou CI remoto flaky/não relacionado como gate do fast path. Um
bug/regressão clara ou falha local relevante reproduzível deve ser corrigido
antes do push. Não mascare resultados nem pule testes específicos.

A validação pode incluir, conforme o impacto:

```bash
pnpm prisma:generate
pnpm lint:check
pnpm -w typecheck
pnpm -w test:unit
pnpm -w build
pnpm -w test:e2e
NODE_OPTIONS=--max-old-space-size=3072 pnpm --dir apps/web build:webpack
```

Não executar todos esses comandos mecanicamente quando não forem pertinentes;
selecionar os checks que ajudam a detectar bugs no fluxo afetado. Para escopo
crítico, testar cuidadosamente as propriedades de segurança e integridade
relevantes antes da publicação. Falhas relevantes reproduzíveis devem ser
corrigidas, não mascaradas com `skip`, `only`, `any` ou relaxamento de TypeScript.

Se um PR for usado por decisão explícita, o workflow `CI` pode validar o PR; PR
e approval não são exigidos pela proteção classic atualmente verificada em
`main`. Os jobs selecionam lint, typecheck, build e testes pelas
mudanças afetadas; falha ao determinar escopo executa validação completa. As
auditorias de segurança/workspace e testes de auth, RLS e `contaId` ajudam a
validar alterações de código de risco; Playwright crítico cobre mudanças de
web, auth, tenant e financeiro. O workflow noturno `E2E Full` mantém os quatro
shards completos. A execução/exigência dos checks depende da configuração
GitHub ativa; o fast path não deve esperar resultados remotos flaky ou sem
relação com o diff. Na proteção atual, não há status check obrigatório; o
push direto não espera CI remoto.

## 3. Projetos Vercel e build

Os comandos `ignoreCommand` em `apps/web/vercel.json` e
`apps/admin/vercel.json` são relativos aos Root Directories `apps/web` e
`apps/admin`, respectivamente. Os Root Directories e a opção nativa para
ignorar deploys sem mudanças no diretório raiz ou dependências são configurações
externas no dashboard. O `ignoreCommand` ignora mudanças somente em
documentação/Markdown e mantém deploy seletivo para alterações limitadas a um
único app, mesmo quando acompanhadas de documentação. Mudanças em packages ou
configurações globais consultam o grafo Turbo para considerar dependências. Se
faltarem commits, caminhos ou dados do Turbo no checkout raso, o build continua
por segurança.

Para reproduzir localmente o build de `apps/web` quando pertinente:

```bash
NODE_OPTIONS=--max-old-space-size=3072 pnpm --dir apps/web build:webpack
```

O Next usa `apps/web/tsconfig.build.json` durante o build para não incluir os
testes no typecheck da aplicação. O typecheck necessário ao escopo continua
sendo uma etapa separada; não o remova para fazer deploy passar.

Quando a operação exigir publicação manual de artefato Vercel, separar build de
publicação e usar credenciais locais seguras ou secrets aprovados:

```bash
vercel pull --yes --environment=production --token="$VERCEL_TOKEN"
vercel build --prod --token="$VERCEL_TOKEN"
vercel deploy --prebuilt --prod --token="$VERCEL_TOKEN"
```

Fixar versão conhecida do CLI no pipeline aplicável. Não registrar tokens em
arquivos, comandos persistidos ou logs. Quando um preview já validado puder ser
promovido como o mesmo artefato, usar o procedimento de promoção aprovado para
esse projeto; isso evita recompilar entre teste e produção.

## 4. Migrations e backfills

Mudanças de schema/dados precisam de validação específica antes da execução,
sobretudo quando houver potencial de dano irreversível. Isso protege dados e
integridade real e não é um gate burocrático. Toda migration versionada exigida
pela mudança deve ser testada em banco descartável ou branch Neon e aplicada à
branch/database Neon de produção como etapa do release; aplicá-la localmente
não conclui o release. Planeje compatibilidade entre versões e janela
operacional.

1. Criar/revisar a migration e aplicá-la em banco descartável ou branch Neon de
   teste. Validar schema, dados existentes, isolamento `contaId` e integridade
   financeira/acadêmica relevante.
2. Configurar a conexão de produção por mecanismo seguro. Confirmar no dashboard
   Neon e pelo endpoint que o target é a branch/database de produção; `DIRECT_URL`
   deve apontar diretamente ao endpoint não pooled. Não imprimir nem registrar
   credenciais.
3. Consultar o estado antes da aplicação e aplicar apenas migrations
   versionadas:

   ```bash
   pnpm exec prisma migrate status --schema=prisma/schema.prisma
   pnpm exec prisma migrate deploy --schema=prisma/schema.prisma
   pnpm exec prisma migrate status --schema=prisma/schema.prisma
   ```

   Os comandos usam o `DIRECT_URL` de produção configurado no ambiente seguro.
   Nunca usar `prisma migrate dev` em produção. Confirmar que o status final
   inclui as migrations esperadas e não deixa migrations pendentes.
   O build Vercel de produção também confirma a identidade do projeto, branch e
   banco Neon e executa `prisma migrate status`; falha antes do build se o
   target estiver incorreto, `DIRECT_URL` estiver ausente ou houver migration
   pendente. A identidade esperada do projeto e da branch está versionada em
   `scripts/validate-vercel-production-schema.mjs`; ao substituir a branch de
   produção, atualizar e revisar essa validação. A checagem é somente leitura e
   não aplica migrations.
4. Executar backfill com escopo explícito, dry-run por padrão, lock e
   idempotência.
5. Validar contagens, totais financeiros, `contaId` e auditoria.
6. Ordenar migration e código levando em conta que push pode disparar Vercel
   automaticamente: aplicar antes do push somente migration backwards-compatible
   com a aplicação atualmente em produção. Para mudanças incompatíveis ou
   destrutivas, usar expand/contract ou deploy em fases, preservando
   compatibilidade em cada fase.

Falha de migration é falha real: não publicar código que dependa dela até
corrigir e aplicar a migration com segurança. O fast path não remove essa
salvaguarda.

Nunca apagar registros financeiros históricos para corrigir um total. Uma
divergência ambígua deve virar fila de reconciliação.

## 5. Pós-deploy e rollback

Após qualquer push que deva publicar produção, acompanhar o deployment até
`Ready`. Confirmar SHA esperado e aliases de produção no dashboard Vercel. Para
mudanças com impacto operacional, executar smoke checks somente de leitura:
login/autorização por conta, rota protegida financeira, métricas sem cache
antigo e logs sem erro novo de runtime.

Em caso de regressão, interromper novas publicações e fazer rollback para a
última implantação `Ready` pelo procedimento aprovado da Vercel. Não corrigir
dados de produção manualmente sem identificar a causa e registrar a operação.

## Diagnóstico de falhas

- `Queued`: aguardar capacidade da Vercel; não criar deploys duplicados.
- `Error` ou build falho: inspecionar logs, corrigir a causa e repetir os checks
  pertinentes antes de novo push.
- `Out of memory`: verificar escopo do TypeScript, workers, cache e se
  `NODE_OPTIONS` foi aplicado ao processo que executa o Next.
- Parou em `Running TypeScript`: conferir `tsconfig.build.json`, quantidade de
  arquivos e reproduzir com `next build --webpack`.
- Build local passa e Vercel falha: comparar Node, pnpm, variáveis, comando,
  região e cache; usar `vercel build --prod` quando necessário.
- Deploy `Ready`, mas tela mostra valor antigo: validar cache HTTP, cache do
  React Query, commit/alias ativo e resposta autenticada da API.
- Push sem deployment: verificar configuração de integração GitHub/Vercel,
  filtros/ignore command e projeto/branch de produção no dashboard. Não afirmar
  publicação concluída até existir implantação `Ready` para o SHA esperado.

## Evidências para fechar um deploy

Registrar na operação (ou no PR, quando exigido) SHA do commit, ID/URL da
implantação, status `Ready`, aliases confirmados, checks locais/CI executados,
migrations/backfills e smoke checks aplicáveis, riscos restantes e rollback
conhecido.

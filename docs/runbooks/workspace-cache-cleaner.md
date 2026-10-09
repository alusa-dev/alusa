# Limpeza automática dos caches locais do workspace

O LaunchAgent `com.alusa.workspace-cache-cleaner` verifica o espaço livre a cada
30 minutos e também ao carregar a sessão do usuário. A limpeza só acontece
quando há menos de 10 GiB livres no volume do checkout.

O script é restrito a este checkout e só esvazia:

- `apps/web/node_modules/.cache`
- `apps/web/.next/cache`
- `.turbo`

Ele mantém os diretórios e remove apenas seu conteúdo regenerável. Não toca no
restante de `node_modules`, store global do pnpm, `coverage`, `dist`, uploads,
banco de dados, fontes ou outros checkouts. Antes de remover, valida o root
canônico do repositório e os caminhos canônicos das três allowlists. Se detectar
um processo Node/pnpm/Next/Turbo/Storybook/Vite/Webpack cujo diretório atual
esteja neste workspace, adia a limpeza até a próxima verificação.

Para inspecionar manualmente, sem apagar arquivos:

```sh
scripts/clean-workspace-caches.sh --inspect
```

Instalar ou atualizar o LaunchAgent nesta máquina:

```sh
scripts/install-workspace-cache-cleaner.sh install
```

Consultar ou remover:

```sh
scripts/install-workspace-cache-cleaner.sh status
scripts/install-workspace-cache-cleaner.sh uninstall
```

O job e o log ficam na sessão do usuário; não requer privilégios de administrador.

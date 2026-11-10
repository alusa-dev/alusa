# Desenvolvimento local do Alusa Mobile

Guia para conectar um iPhone ao app Expo e à API local. Os comandos abaixo são para desenvolvimento local; não use banco de produção.

## Iniciar web/API e Metro

1. Configure as variáveis locais do monorepo conforme `.env.example` e `apps/mobile/.env.example`. Para iPhone físico, defina `EXPO_PUBLIC_API_URL` no `apps/mobile/.env.local` com o IP LAN atual do computador, por exemplo `http://<IP-DO-COMPUTADOR>:3000`. O IP pode mudar entre redes. Defina `EXPO_PUBLIC_MOBILE_AUTH_ENABLED=true`.
2. Confirme que o banco local está disponível e que o ambiente é de desenvolvimento:

   ```bash
   pg_isready
   pnpm env:check:dev
   pnpm exec prisma migrate status --schema=prisma/schema.prisma
   ```

3. Inicie web/API em um terminal:

   ```bash
   pnpm dev:web
   ```

4. Inicie Metro em outro terminal:

   ```bash
   pnpm dev:mobile
   ```

   Conecte o iPhone e o computador à mesma rede Wi-Fi e abra o QR code atual no Expo Go ou no development build. A API usa normalmente a porta `3000`; Metro usa `8081`. Se algo não conectar, verifique se ambas estão livres/escutando (`lsof -nP -iTCP:3000 -iTCP:8081 -sTCP:LISTEN`). Depois de mudar qualquer variável `EXPO_PUBLIC_*`, encerre e reinicie Metro para que o bundle receba o novo valor.

## Expo Go incompatível ou “No apps connected”

Expo Go precisa corresponder ao SDK usado pelo projeto. Compare a versão exibida no erro do Expo Go com a configuração calculada do app e rode o diagnóstico:

```bash
pnpm --filter @alusa/mobile exec expo config --type public
pnpm --filter @alusa/mobile run doctor
pnpm --filter @alusa/mobile exec expo install --check
```

Se os SDKs divergirem, atualize/instale dependências compatíveis seguindo a documentação oficial do Expo ou abra o projeto em um development build correspondente. Para `No apps connected`, confirme que Metro segue ativo, que o telefone leu o QR code dessa execução e que telefone e computador estão na mesma rede; confira também a porta `8081` e reinicie Metro.

## Banco, health check e login

`pnpm env:check:dev` valida variáveis e conexão, mas a proteção contra produção também deve ser verificada explicitamente antes de qualquer migration. `pnpm db:migrate:local` carrega `.env.local`; só execute depois de confirmar que **DATABASE_URL e DIRECT_URL** apontam para o banco local esperado (`localhost`/`127.0.0.1`) e que nenhum deles contém host/nome de produção. Se não conseguir verificar os dois alvos com clareza, não rode a migration. Nunca substitua `.env.local` por credenciais de produção.

Para uma checagem sem criar fixture, use somente:

```text
GET http://localhost:3000/api/health?lite=1
```

O endpoint `/api/health` sem `?lite=1` grava/atualiza uma fixture de desenvolvimento. Um `GET /api/mobile/auth/login` retornando `405 Method Not Allowed` é esperado quando usado apenas para confirmar que a rota/API responde: login aceita `POST`.

Para testar autenticação, faça login pela tela do app usando credenciais de desenvolvimento já provisionadas. Não coloque senha ou tokens em comandos, screenshots, logs ou mensagens. A ação “Sair” da tela Conta preserva o acesso salvo e apenas bloqueia a sessão local; ela não revoga o refresh token no servidor. Para encerrar também a sessão diagnóstica no servidor sem copiar tokens, use o fluxo de alteração de senha do app com “Encerrar outras sessões” habilitado; o app revoga as sessões e encerra a sessão atual. Remover o card salvo apaga credenciais locais, mas, isoladamente, não substitui a revogação no servidor.

## Acessos salvos e biometria

O Expo SecureStore aceita chaves compostas por letras e números ASCII, ponto, sublinhado e hífen (`[A-Za-z0-9._-]`). Chaves antigas derivadas com `encodeURIComponent` podem conter `%3A` (dois-pontos codificado), caractere inválido no SecureStore; a limpeza do app trata esse formato legado sem interromper a remoção do acesso. Atualize o app e, se a limpeza antiga falhar, no seletor de acessos toque em **Excluir acesso** no card e cadastre-o novamente.

O contexto de autenticação escolhido no login (`authContext`, como OWNER ou PORTAL) é mantido junto ao acesso salvo e reutilizado no desbloqueio por senha/biometria. Para perfis antigos sem esse campo, o contexto é inferido pelo papel do usuário; OWNER é o padrão dos perfis sem papel de portal.

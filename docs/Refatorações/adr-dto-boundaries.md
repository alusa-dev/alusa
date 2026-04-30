# ADR: DTOs como fronteira canônica do monorepo

## Contexto

O monorepo mistura três padrões ao mesmo tempo:

- rotas que validam com DTOs formais e mapeiam entrada/saída;
- rotas que usam schemas locais sem um contrato de saída explícito;
- rotas que devolvem shape montado diretamente a partir do Prisma.

Esse cenário aumenta o acoplamento entre `apps/web`, Prisma, domínio e frontend. Também cria duplicidade de validação, imports profundos e respostas HTTP instáveis.

## Decisão

Adotar DTOs formais como contrato padrão para toda fronteira de módulo, pacote, rota HTTP e integração externa.

Fluxo obrigatório:

`route/controller -> input DTO -> mapper -> use case/service -> mapper -> output DTO -> response`

## Regras

1. DTO existe em fronteiras. Funções internas locais não precisam de DTO.
2. DTO de entrada e DTO de saída são separados.
3. Frontend nunca importa DTO por caminho interno de pacote.
4. Prisma não deve vazar para componente client, hook de UI ou contrato HTTP público.
5. `schema` interno continua permitido quando a validação não representa contrato público.
6. Todo DTO novo deve ter nome consistente:
   - `*.input.dto.ts`
   - `*.result.dto.ts`
   - `*.query.dto.ts`
   - `*.mapper.ts`

## Organização

- `packages/*/src/dtos`: contratos públicos do pacote.
- `apps/web/features/*/dtos`: contratos públicos da feature.
- `apps/web/features/*/mappers`: adaptação entre DTO e shape interno.
- `apps/web/app/api/*`: só coordena autenticação, parse, status HTTP e resposta final.

## Anti-padrões proibidos

- import profundo como `@alusa/finance/dtos/...`;
- retorno HTTP com `prisma.findMany()` ou `select` exposto diretamente;
- DTO reutilizado como entity, command interno e response ao mesmo tempo;
- arquivo `dtos.ts` genérico servindo só como alias legado.

## Definição de pronto

- toda rota prioritária tem input DTO e output DTO explícitos;
- contratos públicos passam por barrel público;
- imports profundos de DTO foram removidos;
- mudança de contrato quebra teste de DTO ou teste de rota.

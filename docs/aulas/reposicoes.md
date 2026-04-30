# Reposições

## Objetivo

Registrar e acompanhar compensações de aula sem quebrar a rastreabilidade da agenda e da frequência.

## Tela

Página principal:

- /aulas/reposicoes

Componentes centrais:

- ReposicoesPage
- MakeupClassDialog
- MakeupClassDetailsSheet

## Capacidades

- listar reposições por filtros
- criar reposição individual
- criar reposição coletiva
- escolher evento de origem
- reutilizar evento destino existente
- criar evento destino novo quando necessário
- concluir reposição
- cancelar reposição
- consultar detalhes completos da compensação

## Endpoints

### GET /api/aulas/reposicoes

Lista reposições por filtros.

Parâmetros:

- turmaId
- alunoId
- status
- startDate
- endDate

### POST /api/aulas/reposicoes

Cria uma nova reposição.

### GET /api/aulas/reposicoes/[id]

Obtém detalhes completos de uma reposição.

### PATCH /api/aulas/reposicoes/[id]

Atualiza estado ou dados permitidos da reposição.

## Contrato de rastreabilidade

Toda reposição deve responder:

- qual foi a origem
- quem foi impactado
- qual foi o evento destino
- em que estado ela está

## Regras de integridade relevantes

Quando o fluxo usa evento destino já existente, o backend valida:

- turma compatível
- tipo compatível
- status compatível

Isso impede anexar reposição a um destino operacionalmente inválido.

## Relação com agenda e frequência

- reposição altera a operação real da agenda
- quando a reposição usa evento destino, a frequência é lançada na ocorrência real desse destino
- alunos de reposição podem aparecer na chamada do evento destino quando elegíveis pelo vínculo da compensação

## Estados usuais

- PENDENTE
- REALIZADA
- CANCELADA

## Regra de UX aplicada

A página evita duplicidade de heading semântico e mantém leitura única do contexto principal da tela.

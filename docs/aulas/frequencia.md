# Frequência

## Objetivo

Registrar a chamada da ocorrência real da aula, mantendo rastreabilidade por evento, turma e aluno.

## Telas

Página principal:

- /aulas/frequencia

Componentes centrais:

- FrequenciaPage
- AttendanceTurmaDialog
- AttendanceSheet
- AttendanceHistoryTurmaDialog
- AttendanceHistoryEventSheet

## Modos de uso

### Workspace

Mostra as turmas operacionais do dia selecionado.

Capacidades:

- navegar por data
- buscar turma
- abrir uma turma
- escolher a ocorrência do dia
- lançar ou atualizar frequência

### Histórico

Mostra o histórico por turma dentro do período filtrado.

Capacidades:

- filtrar por turma, professor e período
- abrir histórico da turma
- visualizar ocorrência histórica
- baixar PDF da chamada

## Endpoints

### GET /api/aulas/frequencia/workspace

Lista o workspace operacional por data.

Parâmetros:

- date
- search

### GET /api/aulas/frequencia/turmas/[turmaId]

Obtém o workspace detalhado de uma turma para o dia selecionado.

### GET /api/aulas/frequencia/[eventId]

Obtém o detalhe da chamada de um evento.

### PUT /api/aulas/frequencia/[eventId]

Salva a frequência de um evento.

### GET /api/aulas/frequencia

Lista histórico agregado por turma.

Parâmetros:

- startDate
- endDate
- turmaId
- professorId

### GET /api/aulas/frequencia/turmas/[turmaId]/historico

Lista ocorrências históricas lançadas para uma turma.

## Política operacional de lançamento

Constante principal:

- ATTENDANCE_LAUNCH_WINDOW_DAYS = 7

Decisões possíveis da política:

- ELIGIBLE
- BEFORE_EVENT_DAY
- WINDOW_EXPIRED
- EVENT_CANCELLED

Regras:

- frequência só pode ser lançada a partir do dia da aula
- eventos cancelados não permitem chamada
- a janela de lançamento e correção expira após o prazo definido

## Integridade do lançamento

O client envia itens por aluno, mas o backend reconcilia os elegíveis do evento antes de persistir.

Proteções atuais:

- aluno precisa pertencer ao conjunto elegível da ocorrência
- matriculaId não é confiado cegamente ao payload do client
- o registro persiste a matrícula resolvida do lado servidor

## Escopo de professor

Quando o usuário é PROFESSOR:

- o escopo é resolvido por vínculo ativo com professor da conta
- o workspace filtra automaticamente pelas turmas desse professor

Quando o vínculo não é encontrado:

- o backend retorna professorScope.reason = PROFESSOR_NOT_LINKED
- a UI mostra aviso explícito em vez de um vazio silencioso

## Estados exibidos no workspace

- EM_ANDAMENTO
- PENDENTE
- FUTURA
- REALIZADA
- CANCELADA
- SEM_AULA

Esses estados ajudam a ordenar e destacar a prioridade operacional das turmas do dia.

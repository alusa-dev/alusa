# Agenda

## Objetivo

Ser o calendário operacional central do módulo Aulas, com visão por ocorrência real e não apenas por regra cadastral.

## Tela

Página principal:

- /aulas/agenda

Componentes centrais:

- AgendaPage
- CalendarScheduler
- AgendaFilters
- CalendarEventDialog
- CalendarEventSheet
- AgendaOperationLogSheet

## Capacidades

- criar evento manual
- editar evento existente
- listar por intervalo
- alternar modo de visualização da grade (semana / mês compacto / mês detalhado)
- filtrar por turma, professor, sala, tipo e status
- abrir evento com detalhes operacionais
- marcar como realizado
- cancelar
- abrir atalho para frequência quando permitido
- consultar logs operacionais
- reconstruir janela da agenda

## Endpoints

### GET /api/aulas/agenda

Lista eventos da agenda por intervalo e filtros.

Parâmetros relevantes:

- start
- end
- turmaId
- professorId
- salaId
- type
- status
- viewMode

Observação:

- para professor, o professorId é forçado pelo escopo resolvido da sessão

### POST /api/aulas/agenda

Cria evento manual da agenda.

### GET /api/aulas/agenda/[eventId]

Obtém detalhes completos de um evento.

### PATCH /api/aulas/agenda/[eventId]

Atualiza um evento existente.

### GET /api/aulas/agenda/logs

Lista logs operacionais da agenda.

### POST /api/aulas/agenda/rebuild

Reconstrói uma janela da agenda conforme o contrato de rebuild.

## Estados operacionais do evento

- AGENDADO
- REALIZADO
- CANCELADO

Além do status persistido, a UI trabalha com estado temporal para orientar ação:

- future
- today
- in_progress
- pending_closure

## Política de frequência na Agenda

A Agenda só deve expor o CTA de frequência quando a política permitir.

Bloqueios principais:

- evento cancelado
- dia futuro fora do dia operacional da ocorrência
- janela operacional expirada

Isso evita divergência entre o que a UI oferece e o que o backend aceita.

## Fechamento automático

O fechamento automático de eventos atrasados foi centralizado em política explícita.

Objetivo:

- evitar eventos antigos indefinidamente abertos
- manter agenda coerente com a operação real
- reduzir pendências artificiais no workspace de frequência

## Logs e auditoria

A agenda mantém logs operacionais para ações relevantes.

Uso principal:

- rastrear alterações e rebuild
- apoiar diagnóstico de inconsistências
- dar visibilidade administrativa sobre mutações operacionais

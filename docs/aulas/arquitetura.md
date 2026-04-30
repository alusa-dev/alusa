# Arquitetura do módulo Aulas

## Camadas

O módulo está organizado em três camadas principais dentro de apps/web:

- app/api/aulas: rotas HTTP do App Router
- features/aulas: telas, hooks, serviços client-side, DTOs e utilitários
- src/server/aulas: regras de negócio, acesso, sessão, erros e integração com Prisma

## Estrutura principal

### Frontend

- features/aulas/agenda
- features/aulas/frequencia
- features/aulas/reposicoes
- features/aulas/calendar
- features/aulas/dtos
- features/aulas/utils

### Backend

- src/server/aulas/agenda/agenda.service.ts
- src/server/aulas/frequencia/attendance.service.ts
- src/server/aulas/frequencia/attendance-workspace.service.ts
- src/server/aulas/reposicoes/makeup.service.ts
- src/server/aulas/calendar/calendar-core.service.ts
- src/server/aulas/calendar/operation-log.service.ts
- src/server/aulas/session.ts
- src/server/aulas/route-utils.ts
- src/server/aulas/aulas-error.ts

## Permissão e escopo

Papéis autorizados:

- ADMIN
- RECEPCAO
- PROFESSOR

Regras:

- ADMIN e RECEPCAO operam sem filtro automático de professor
- PROFESSOR opera com escopo resolvido por e-mail em professor ativo da mesma conta
- Se o usuário PROFESSOR não tiver vínculo ativo resolvido, o workspace de frequência retorna estado explícito de bloqueio operacional

## Tratamento de erro

Padrão de resposta:

- validação inválida: HTTP 422 com error VALIDACAO_INVALIDA
- erro de domínio: HTTP mapeado por AulasError
- erro inesperado: HTTP 500 com fallback específico da rota

Exemplos de erros de domínio relevantes:

- FREQUENCIA_DIA_INVALIDO
- FREQUENCIA_FORA_DA_JANELA
- OPERACAO_NAO_PERMITIDA
- TURMA_NAO_ENCONTRADA

## Entidades operacionais envolvidas

- turma
- professor
- sala
- matricula
- aluno
- calendarEvent
- attendanceRecord
- makeupClass
- agenda operation log

## Fonte de verdade por responsabilidade

- turma, professor e sala: cadastro-base
- calendarEvent: ocorrência operacional da agenda
- attendanceRecord: registro efetivo da chamada
- makeupClass: vínculo rastreável da compensação

## Fluxos principais

### Agenda

- criar evento
- editar evento
- marcar evento como realizado ou cancelado
- visualizar conflitos e relações com reposições
- navegar por calendário e timeline

### Frequência

- consultar workspace do dia por turma
- abrir detalhe da turma
- escolher ocorrência do dia
- lançar ou atualizar frequência por evento
- consultar histórico por turma
- abrir ocorrência histórica e exportar PDF

### Reposições

- listar reposições
- criar reposição individual ou coletiva
- vincular origem e destino
- concluir ou cancelar reposição
- auditar relação com eventos da agenda

## Contratos operacionais relevantes

- a agenda não deve oferecer lançamento de frequência fora da política permitida
- o backend não confia em matriculaId enviado pelo client sem reconciliar com os elegíveis do evento
- evento destino de reposição existente precisa ser compatível com turma, tipo e status
- fechamento automático de evento segue contrato explícito de política

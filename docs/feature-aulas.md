# Documentação de Implementação — Feature **Aulas**

## 1. Objetivo

Definir a implementação da feature **Aulas** na Alusa de forma escalável, minimalista e coerente com a arquitetura já existente do produto, respeitando o que hoje já funciona em **Cadastro**, **Matrículas**, **Rematrículas** e **Financeiro**.

A feature **Aulas** será o núcleo operacional pedagógico da Alusa, responsável por organizar a agenda da escola, registrar frequência, controlar reposições e consolidar um **Calendário Centralizado** como fonte de verdade para datas, horários e agendamentos internos e externos.

---

## 2. Princípios de Produto e Arquitetura

### 2.1. Princípios principais

- **Respeitar o que já existe na Alusa**.
- **Não duplicar entidades já existentes**.
- **Separar cadastro de operação**.
- **Manter interface limpa, rápida e sem poluição visual**.
- **Modelar para escalar sem retrabalho**.
- **Preparar a base para integrações futuras sem implementá-las agora**.
- **Centralizar agenda e eventos em uma única camada de dados**.

### 2.2. Separação correta de responsabilidades

A arquitetura definida é:

- **Cadastro**: criação e manutenção das entidades base.
- **Aulas**: operação do dia a dia a partir dessas entidades.

Isso significa que:

- **Turmas continuam em `Cadastro > Turmas`**.
- O grupo **Aulas** não recria nem duplica a gestão de turmas.
- O grupo **Aulas** consome as turmas, professores, salas e regras já cadastradas.

---

## 3. Escopo funcional da feature Aulas

Neste momento, o grupo **Aulas** terá apenas:

```text
AULAS
 ├ Agenda
 ├ Frequência
 └ Reposições
```

### 3.1. O que entra agora

- Agenda operacional da escola
- Calendário centralizado da Alusa
- Visualizações de calendário e timeline
- Registro e consulta de frequência
- Controle de reposições
- Preparação estrutural para eventos internos e externos da escola

### 3.2. O que não entra agora

- Módulo separado “Hoje”
- Integrações reais com Google Calendar, Notion etc.
- Planejamento pedagógico avançado
- Lista de espera, QR code, app do professor

Esses itens ficam apenas **previstos na organização técnica**, para evitar retrabalho futuro.

---

## 4. Organização do Sidebar

### 4.1. Estrutura atual recomendada

```text
CADASTRO
 ├ Alunos
 ├ Professores
 ├ Turmas
 ├ Salas

AULAS
 ├ Agenda
 ├ Frequência
 └ Reposições
```

### 4.2. Diretriz importante

- **Turmas não devem ser movidas para Aulas**.
- **Aulas consome Turmas**, não gerencia seu cadastro principal.
- Dentro de `Cadastro > Turmas`, pode existir no futuro um atalho como **“Ver agenda da turma”**, abrindo a Agenda filtrada.

---

## 5. Modelo conceitual da feature

A feature Aulas deve se apoiar em quatro camadas conceituais:

1. **Turma** — entidade pedagógica base já existente.
2. **Agenda recorrente da turma** — regra de recorrência da turma.
3. **Evento de calendário** — ocorrência operacional em data/hora específica.
4. **Frequência** — presença dos alunos em um evento de aula.

### 5.1. Fluxo conceitual

```text
Cadastro > Turmas
        ↓
Agenda recorrente da turma
        ↓
Calendário central gera eventos
        ↓
Agenda exibe eventos
        ↓
Frequência registra presença
        ↓
Reposições ajustam ocorrências específicas
```

---

## 6. Calendário Centralizado da Alusa

## 6.1. Definição

A Alusa deve possuir um **Calendário Centralizado** que funcione como **fonte da verdade operacional** para:

- aulas regulares
- reposições
- cancelamentos
- workshops
- eventos internos
- eventos externos
- pausas
- feriados
- substituições pontuais
- demais datas relevantes da escola

Esse calendário **não é apenas visual**. Ele deve existir como **camada de dados oficial**.

## 6.2. Objetivo do calendário centralizado

Evitar cenários como:

- duas aulas na mesma sala
- professor em conflito de horário
- reposições fora de controle
- divergência entre agenda da turma e a operação real
- múltiplas fontes de verdade para datas e agendamentos

## 6.3. Fonte de verdade

Tudo que acontece em data e horário relevantes para a escola deve nascer, convergir ou ser representado no calendário central.

### 6.4. Tipos de eventos previstos

```text
AULA
REPOSICAO
EVENTO_INTERNO
EVENTO_EXTERNO
WORKSHOP
FERIADO
PAUSA
CANCELAMENTO
SUBSTITUICAO
```

## 6.5. Regra arquitetural fundamental

Deve existir diferença explícita entre:

- **Agenda recorrente da turma**: definição padrão da turma
- **Evento gerado no calendário**: ocorrência concreta em data/hora

Isso evita erros graves de modelagem e permite:

- cancelar uma aula específica sem quebrar a recorrência
- criar reposição pontual
- trocar professor apenas em uma ocorrência
- registrar frequência por aula real
- suportar integrações futuras com calendários externos

---

## 7. Como ERPs profissionais estruturam esse módulo

ERPs educacionais profissionais normalmente separam:

- cadastros base
- agenda operacional
- eventos concretos
- frequência
- reposições

O padrão mais maduro é:

- manter **cadastro de turma** fora da operação
- usar um **calendário central como infraestrutura**
- tratar **aula realizada** como evento operacional
- registrar frequência na ocorrência, não na regra da turma
- permitir visões de calendário, timeline e dashboards resumidos

A Alusa deve seguir essa mesma linha, porém com execução minimalista.

---

## 8. Módulo **Agenda**

## 8.1. Papel do módulo

A **Agenda** será o centro operacional do grupo Aulas.

Responsabilidades:

- visualizar os eventos do calendário
- organizar a operação da escola
- abrir detalhes do evento
- registrar frequência a partir da aula
- visualizar conflitos e ocupação
- criar/editar/cancelar ocorrências autorizadas

## 8.2. Não haverá módulo separado “Hoje” neste momento

Foi definido que a primeira versão ficará mais simples:

```text
AULAS
 ├ Agenda
 ├ Frequência
 └ Reposições
```

A experiência diária será concentrada em **Agenda**, com filtros e visões adequadas.

## 8.3. Visões da Agenda

A Agenda terá duas abas principais:

```text
Agenda
 ├ Calendário
 └ Timeline
```

### 8.3.1. Aba Calendário

Visualização tradicional do calendário.

Modos previstos:

- **Semana**
- **Mês detalhado**
- **Mês compacto**

Uso principal:

- ver a grade semanal de aulas
- entender o mês
- localizar eventos rapidamente
- navegar pela operação da escola

### 8.3.2. Aba Timeline

Visualização por recurso, adequada para cenários operacionais.

Pode agrupar por:

- professor
- sala
- turma

Uso principal:

- identificar conflitos
- enxergar ocupação por recurso
- analisar alocação operacional

### 8.3.3. Regra de dados

As abas **Calendário** e **Timeline** devem consumir a **mesma fonte de dados**, mudando apenas a apresentação.

---

## 9. Módulo **Frequência**

## 9.1. Papel do módulo

O módulo Frequência deve centralizar:

- registro de presença por evento de aula
- consulta de histórico
- filtros por turma, aluno, professor e período
- visualização de faltas e presença acumulada

## 9.2. Regra principal

A frequência pertence a uma **ocorrência concreta** de aula, e não apenas à turma.

### Correto

```text
Evento de aula → frequências
```

### Incorreto

```text
Turma → frequência direta sem evento
```

## 9.3. Status previstos

```text
PRESENTE
FALTA
FALTA_JUSTIFICADA
ATRASO
REPOSICAO
```

## 9.4. Regras de exibição

Na chamada, devem aparecer apenas alunos elegíveis para aquela ocorrência, respeitando regras vigentes de matrícula.

---

## 10. Módulo **Reposições**

## 10.1. Papel do módulo

Controlar aulas compensadas sem quebrar a agenda padrão da turma.

## 10.2. Responsabilidades

- registrar reposição individual ou coletiva
- associar origem e destino da reposição
- preservar histórico
- refletir corretamente no calendário
- permitir rastreabilidade operacional

## 10.3. Regras mínimas

Uma reposição deve conseguir responder:

- qual aluno participou
- qual aula/origem motivou a reposição
- em qual evento a reposição ocorreu
- qual foi a turma de origem e a turma/ocorrência de destino

---

## 11. Estilo visual e diretrizes de UX

## 11.1. Direção visual

A feature deve seguir uma linha:

- **minimalista**
- **clean**
- **leve**
- **sem excesso de informação**
- **foco em operação rápida**

## 11.2. Padrões visuais aprovados

Tomar como referência o conjunto de telas analisado, especialmente:

- calendário semanal
- calendário mensal detalhado
- calendário mensal compacto
- timeline por recurso
- modal de criação de evento
- painel de detalhes do evento
- card resumido no dashboard

## 11.3. Diretrizes de interface

### Deve ter

- bastante espaço em branco
- cards simples e legíveis
- hierarquia tipográfica clara
- poucos acentos de cor
- filtros discretos
- navegação direta
- leitura rápida por recepção e coordenação

### Deve evitar

- excesso de badges
- poluição de informações no card do evento
- muitos botões concorrendo atenção
- textos longos em listagens
- múltiplos painéis simultâneos na mesma tela

## 11.4. Informação mínima por evento na agenda

Em cards de agenda, mostrar apenas o essencial:

- nome da turma
- horário
- professor ou sala, conforme contexto visual

Detalhes completos devem abrir em **modal** ou **sheet**, não ficar sempre expostos.

## 11.5. Visualização do dashboard

O dashboard principal pode ter um **card resumido de agenda**, com visão compacta da programação do dia ou timeline reduzida.

Esse card deve:

- ser rápido de ler
- não competir com o calendário completo
- servir como acesso secundário à Agenda

---

## 12. Componentes e dependências

## 12.1. Scheduler recomendado

Foi definido o uso de **FullCalendar** como base principal, por ser a opção gratuita, madura e escalável.

### Dependências-base

```bash
npm install @fullcalendar/react
npm install @fullcalendar/daygrid
npm install @fullcalendar/timegrid
npm install @fullcalendar/interaction
```

### Dependência para timeline / recursos

Conforme necessidade da implementação escolhida, preparar a camada para suportar visão por recurso/timeline de forma organizada.

## 12.2. UI base

Usar os componentes já coerentes com o stack da Alusa, especialmente:

- **shadcn/ui** para estrutura de interface
- **Heroicons** para ícones

## 12.3. Componentes de interface previstos

### Agenda

- Tabs: `Calendário | Timeline`
- filtros por período, professor, sala, turma, tipo
- seletor de visão (`semana`, `mês`, etc.)
- botões de navegação de período

### Criação e edição

- `Dialog` para criação rápida
- `Sheet` ou `Dialog` para detalhe/edição do evento

### Apoio visual

- `Badge` discreto para tipo/status quando necessário
- `Avatar` para professor quando agregar valor
- `DropdownMenu` para filtros e ações secundárias

### Frequência

- lista limpa de alunos
- ações rápidas de presença
- toolbar simples

### Reposições

- tabela ou cards com origem/destino
- filtros por período, aluno, turma e status

---

## 13. Organização do workspace

## 13.1. Regra geral

A implementação deve evitar espalhar regras pela aplicação. O módulo deve ter organização clara entre:

- domínio
- DTOs
- serviços
- componentes
- mapeadores
- tipos
- validações

## 13.2. Estrutura sugerida

```text
apps/web/
  app/
    (protected)/
      aulas/
        agenda/
        frequencia/
        reposicoes/
    api/
      aulas/
        agenda/
        frequencia/
        reposicoes/

src/
  modules/
    aulas/
      components/
        agenda/
        frequencia/
        reposicoes/
      dto/
      services/
      mappers/
      validators/
      types/
      constants/
```

## 13.3. Separação recomendada por contexto

```text
modules/aulas/
  agenda/
  frequencia/
  reposicoes/
  calendar/
```

Onde:

- `calendar/` guarda a camada central de eventos e recorrência
- `agenda/` cuida da apresentação e casos de uso visuais
- `frequencia/` cuida do registro e consulta
- `reposicoes/` cuida das compensações

---

## 14. Uso de DTOs e contratos

## 14.1. Princípio

Toda entrada e saída da feature deve passar por DTOs explícitos, evitando:

- acoplamento direto com ORM
- payloads inconsistentes
- duplicação de formatos
- lógica de transformação espalhada

## 14.2. DTOs mínimos sugeridos

### Agenda

- `ListCalendarEventsRequestDto`
- `ListCalendarEventsResponseDto`
- `CreateCalendarEventRequestDto`
- `UpdateCalendarEventRequestDto`
- `CalendarEventDetailsResponseDto`

### Frequência

- `ListAttendanceRequestDto`
- `SaveAttendanceRequestDto`
- `AttendanceResponseDto`

### Reposições

- `CreateMakeupClassRequestDto`
- `ListMakeupClassesRequestDto`
- `MakeupClassResponseDto`

### Recursos de apoio

- `CalendarFilterDto`
- `CalendarResourceDto`
- `CalendarViewDto`

## 14.3. Regra de mapeamento

Nunca usar entidades de persistência diretamente na UI.

Fluxo recomendado:

```text
Database Entity
  ↓
Mapper
  ↓
DTO de resposta
  ↓
UI
```

---

## 15. Evitar duplicidade

## 15.1. Não duplicar entidades já existentes

A feature Aulas deve consumir o que já existe em:

- alunos
- turmas
- professores
- salas
- matrículas

## 15.2. Não duplicar regras de negócio

Regras como elegibilidade de matrícula, status operacional e capacidade devem vir de fontes canônicas já existentes sempre que possível.

## 15.3. Não duplicar agendas em múltiplos lugares

A agenda deve nascer da camada central de calendário.

Evitar:

- agenda da turma em um lugar
- agenda da agenda em outro
- reposição em tabela isolada sem refletir no calendário

Tudo deve convergir para a camada de eventos centralizados.

---

## 16. Organização do banco de dados

## 16.1. Diretriz principal

A modelagem deve **respeitar o que já existe hoje na Alusa**, evitando quebrar estruturas consolidadas. O novo domínio deve ser acrescentado de forma incremental.

## 16.2. Camadas recomendadas

### 1. Agenda recorrente da turma

Tabela para guardar a regra padrão da turma.

Sugestão conceitual:

```text
TurmaAgendaRecorrente
```

Campos sugeridos:

- `id`
- `turmaId`
- `diaSemana`
- `horaInicio`
- `horaFim`
- `dataInicio`
- `dataFim` (opcional)
- `salaId` (se fizer sentido canônico)
- `professorId` (se fizer sentido canônico)
- `ativo`
- `createdAt`
- `updatedAt`

### 2. Evento centralizado do calendário

Tabela principal da operação.

Sugestão conceitual:

```text
CalendarEvent
```

Campos sugeridos:

- `id`
- `tipo`
- `status`
- `titulo`
- `descricao`
- `startAt`
- `endAt`
- `turmaId` (opcional conforme tipo)
- `professorId` (opcional conforme tipo)
- `salaId` (opcional conforme tipo)
- `origemRecorrenciaId` (opcional)
- `origemExterna` (opcional, para preparação futura)
- `externalProvider` (opcional)
- `externalEventId` (opcional)
- `createdAt`
- `updatedAt`
- `cancelledAt` (opcional)

### 3. Frequência

Sugestão conceitual:

```text
AttendanceRecord
```

Campos sugeridos:

- `id`
- `calendarEventId`
- `alunoId`
- `matriculaId` (se necessário para vínculo histórico correto)
- `status`
- `observacao`
- `recordedAt`
- `recordedByUserId`
- `createdAt`
- `updatedAt`

### 4. Reposição

Sugestão conceitual:

```text
MakeupClass
```

Campos sugeridos:

- `id`
- `alunoId`
- `matriculaId`
- `eventoOrigemId`
- `eventoDestinoId`
- `turmaOrigemId`
- `turmaDestinoId`
- `status`
- `observacao`
- `createdAt`
- `updatedAt`

## 16.3. Regras importantes da modelagem

- frequência sempre ligada ao **evento**
- reposição sempre ligada a **origem e destino**
- recorrência separada de ocorrência
- preparação para eventos externos sem acoplar integração desde já

---

## 17. Preparação para integrações futuras

## 17.1. Objetivo desta preparação

Neste momento, a Alusa **não implementará integrações externas**, mas a arquitetura deve ser organizada para que isso possa acontecer depois sem refatoração estrutural.

## 17.2. Integrações previstas conceitualmente

- Google Calendar
- Notion
- outros calendários/provedores externos

## 17.3. Diretrizes para não gerar retrabalho futuro

### 1. Ter identidade externa opcional no evento

O `CalendarEvent` deve conseguir armazenar:

- provedor externo
- identificador externo
- origem do evento
- data de sincronização, se isso vier a existir futuramente

### 2. Separar evento interno de adaptadores externos

A regra da Alusa deve depender de seu próprio modelo interno.

Ou seja:

```text
Provedor externo → Adapter → CalendarEvent interno
```

Nunca modelar o sistema diretamente em torno da estrutura do Google ou de outra ferramenta.

### 3. Manter contratos de sincronização fora do domínio principal

Sugestão conceitual futura:

```text
integrations/calendar/
  google/
  notion/
```

### 4. O calendário central da Alusa continua sendo a fonte de verdade

Mesmo com integração futura, a regra deve continuar sendo:

- a Alusa possui seu próprio calendário central
- integrações externas são apenas conectores
- a operação principal depende do modelo interno

---

## 18. Regras de negócio fundamentais

## 18.1. Regra de responsabilidade

- Cadastro define a estrutura base.
- Aulas executa a operação.

## 18.2. Regra de agenda

- Agenda recorrente define o padrão.
- Evento concreto representa a realidade operacional.

## 18.3. Regra de frequência

- frequência é sempre vinculada ao evento concreto
- apenas alunos elegíveis devem aparecer para chamada

## 18.4. Regra de reposição

- reposição não substitui a estrutura da turma
- reposição deve ser rastreável
- reposição deve refletir no calendário

## 18.5. Regra de visualização

- a Agenda deve mostrar informação enxuta
- detalhes completos abrem sob demanda
- a UI deve priorizar rapidez operacional

## 18.6. Regra de consistência

- não criar múltiplas fontes de agenda
- não repetir regras existentes em outros módulos
- não acoplar UI diretamente à persistência

---

## 19. Componentes visuais principais da implementação

## 19.1. Agenda

- `AgendaPage`
- `AgendaViewTabs`
- `CalendarScheduler`
- `TimelineScheduler`
- `CalendarToolbar`
- `CalendarFilters`
- `CalendarEventCard`
- `CalendarEventDialog`
- `CalendarEventSheet`

## 19.2. Frequência

- `AttendancePage`
- `AttendanceFilters`
- `AttendanceList`
- `AttendanceSheet`
- `AttendanceSummaryCard`

## 19.3. Reposições

- `MakeupClassesPage`
- `MakeupClassesTable`
- `MakeupClassDialog`
- `MakeupClassDetailsSheet`

## 19.4. Dashboard

- `AgendaDashboardCard`

---

## 20. Funcionalidades por tela

## 20.1. Agenda

### Deve permitir

- visualizar eventos por período
- navegar entre períodos
- alternar entre calendário e timeline
- filtrar por turma, professor, sala e tipo
- abrir detalhe do evento
- criar evento quando aplicável
- editar/cancelar evento quando aplicável
- iniciar registro de frequência a partir do evento

## 20.2. Frequência

### Deve permitir

- registrar presença por evento
- consultar histórico
- filtrar por turma, aluno e período
- visualizar indicadores simples de presença/falta

## 20.3. Reposições

### Deve permitir

- registrar reposição
- consultar histórico
- rastrear origem e destino
- relacionar aluno, matrícula e eventos envolvidos

---

## 21. Estratégia de implementação incremental

## Fase 1 — Base estrutural

- criar a camada central de calendário
- criar recorrência de agenda da turma
- criar listagem de eventos da agenda
- renderizar aba Calendário

## Fase 2 — Operação básica

- detalhe de evento
- criação/edição de eventos permitidos
- integração com frequência por evento

## Fase 3 — Reposições

- cadastro e consulta de reposições
- reflexo no calendário
- rastreamento entre origem e destino

## Fase 4 — Timeline e dashboard

- visão timeline por recurso
- card resumido no dashboard

## Fase 5 — Preparação avançada

- refinamento para adaptadores externos
- metadados para sincronização futura

---

## 22. Decisões já definidas

### Definido

- grupo do sidebar será **Aulas**
- subitens atuais: **Agenda, Frequência e Reposições**
- **Turmas permanece em Cadastro**
- **não haverá módulo Hoje neste momento**
- **Agenda será o centro operacional**
- haverá **Calendário Centralizado da Alusa**
- a Agenda terá abas **Calendário** e **Timeline**
- o padrão visual será **minimalista, limpo e sem poluição**
- base recomendada do scheduler: **FullCalendar**
- preparar estrutura para futuras integrações, sem implementá-las agora
- separar recorrência de ocorrência concreta
- usar DTOs e mapeadores para evitar acoplamento e duplicidade

---

## 23. Resumo executivo

A feature **Aulas** da Alusa será implementada como um módulo operacional enxuto, escalável e compatível com a arquitetura atual do sistema.

### Estrutura definida

```text
AULAS
 ├ Agenda
 ├ Frequência
 └ Reposições
```

### Pilares técnicos

- calendário centralizado como fonte de verdade
- agenda recorrente separada de ocorrência concreta
- frequência vinculada ao evento
- reposições rastreáveis
- UI minimalista
- DTOs explícitos
- sem duplicar turmas e regras já existentes
- preparada para integrações futuras sem retrabalho estrutural

### Resultado esperado

Uma feature profissional, coerente com ERPs educacionais maduros, mas implementada de forma limpa e incremental dentro da realidade atual da Alusa.


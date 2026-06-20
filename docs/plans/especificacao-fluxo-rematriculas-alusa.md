# Especificação Funcional e Arquitetural do Fluxo de Rematrículas da Alusa

## 1. Objetivo

Este documento define o fluxo completo de rematrículas da Alusa, contemplando:

- campanhas de rematrícula;
- rematrículas avulsas;
- rematrículas individuais e familiares;
- alunos menores e maiores de idade;
- reserva de vaga para o próximo ciclo;
- matrícula, turma, contrato e financeiro futuros;
- transição entre o vínculo atual e o próximo vínculo;
- integração financeira white label com o Asaas;
- prevenção de duplicidades, sobreposições e inconsistências operacionais;
- acompanhamento gerencial, comunicação, auditoria e métricas.

A regra central é:

> **Rematrícula não altera imediatamente a matrícula atual. Ela confirma a permanência, reserva a vaga e prepara o próximo vínculo, que somente entra em vigor na data efetiva do novo ciclo.**

A escola pode iniciar a campanha de rematrícula meses antes do encerramento do contrato atual. Durante esse período, o aluno permanece normalmente na turma atual, com contrato e financeiro atuais preservados.

---

## 2. Princípios de domínio

### 2.1. Campanha não é rematrícula

A campanha é o contêiner operacional e gerencial do processo coletivo.

Ela define:

- período de destino;
- público elegível;
- datas da campanha;
- regras gerais;
- comunicação;
- indicadores;
- acompanhamento de participantes.

A rematrícula é o processo de domínio que:

- registra a decisão;
- seleciona o próximo vínculo;
- reserva a vaga;
- prepara matrícula futura;
- prepara contrato futuro;
- prepara financeiro futuro;
- controla alterações, cancelamento e ativação.

Encerrar, pausar ou arquivar uma campanha não deve apagar ou cancelar rematrículas já confirmadas.

### 2.2. A unidade real de rematrícula é o vínculo atual

A unidade de domínio não deve ser apenas o aluno.

Deve ser:

```text
matrícula ou vínculo acadêmico de origem
+ período de destino
```

Isso é necessário porque um mesmo aluno pode participar de vários serviços simultaneamente.

Exemplo:

```text
Nicole

Ballet:
rematricular para 2027

Jazz:
não continuará

Teatro:
decidir depois
```

A interface pode agrupar por aluno ou responsável, mas as decisões devem permanecer independentes por vínculo de origem.

### 2.3. A campanha pode começar a qualquer momento

A escola pode iniciar a campanha:

- cinco meses antes;
- três meses antes;
- um mês antes;
- poucos dias antes;
- em uma data personalizada.

A data da campanha não altera automaticamente:

- a matrícula atual;
- a turma atual;
- o contrato atual;
- a assinatura atual;
- a frequência;
- o calendário atual.

### 2.4. Confirmação antecipada não é ativação

Confirmar a rematrícula significa:

```text
permanência confirmada
+ vaga futura reservada
+ próximo vínculo preparado
```

Não significa:

```text
troca imediata de turma
+ encerramento antecipado do contrato atual
+ início imediato do novo financeiro
```

### 2.5. O vínculo atual não deve ser adulterado

A confirmação da rematrícula não pode alterar silenciosamente:

- turma atual;
- combo atual;
- plano atual;
- contrato atual;
- pagador atual;
- assinatura atual;
- situação acadêmica atual;
- aulas e frequência atuais.

Tudo relacionado ao próximo ciclo deve existir separadamente.

### 2.6. O próximo vínculo possui vigência própria

O próximo vínculo deve possuir:

- período de destino;
- turma ou combo futuro;
- plano futuro;
- data efetiva de início;
- data prevista de encerramento;
- contrato futuro;
- acordo financeiro futuro;
- reserva de vaga;
- relação com o vínculo de origem.

### 2.7. A transição ocorre somente na data efetiva

Na data efetiva:

```text
vínculo atual → encerrado
reserva futura → convertida em ocupação ativa
matrícula futura → ativa
contrato futuro → vigente
financeiro futuro → provisionando ou ativo
```

A transição deve ser idempotente, auditável e executada de forma segura.

---

## 3. Modelo temporal

A Alusa deve separar claramente as datas do processo.

### 3.1. Datas da campanha

```text
campaignStartsAt
campaignEndsAt
```

Definem quando a escola ou os responsáveis podem participar da campanha.

### 3.2. Data da confirmação

```text
confirmedAt
```

Registra quando a rematrícula foi confirmada.

### 3.3. Encerramento do contrato atual

```text
currentContractEndsAt
```

Define até quando o vínculo atual permanece vigente.

### 3.4. Início do próximo vínculo

```text
effectiveAt
```

É a data em que o próximo vínculo acadêmico passa a valer.

Regra sugerida:

```text
effectiveAt = maior valor entre:
- dia seguinte ao fim do contrato atual;
- início oficial do período de destino
```

Essa data deve ficar explícita no preview, ser armazenada na confirmação e nunca ser recalculada silenciosamente.

### 3.5. Primeira cobrança futura

```text
firstDueDate
```

Pode coincidir ou não com `effectiveAt`, conforme a política financeira da escola.

### 3.6. Prazo de edição

```text
editableUntil
```

Define até quando alterações no próximo vínculo podem ser realizadas sem autorização especial.

### 3.7. Exemplo

```text
Campanha abre:                 01/02/2026
Responsável confirma:          15/02/2026
Contrato atual termina:        04/07/2026
Próximo vínculo começa:        05/07/2026
Primeiro vencimento futuro:    10/07/2026
```

---

## 4. Estrutura principal da área de rematrículas

A página principal deve ser organizada assim:

```text
Gestão de Rematrículas

[ Campanhas ] [ Todos os processos ]

[ Rematrícula avulsa ] [ Criar campanha ]
```

### 4.1. Campanhas

É a visão principal e gerencial.

Exemplos:

- Rematrículas 2027;
- Renovação do 2º semestre de 2027;
- Rematrícula antecipada de Ballet Infantil;
- Renovação de bolsistas 2027.

Cada campanha deve mostrar:

- nome;
- período de destino;
- data de início e fim;
- status;
- vínculos elegíveis;
- não iniciados;
- em andamento;
- confirmados;
- concluídos;
- aguardando responsável;
- requerendo atenção;
- não renovados;
- percentual de conversão;
- percentual de conclusão.

Ações:

- abrir;
- editar;
- ativar;
- pausar;
- encerrar;
- duplicar configurações;
- arquivar.

### 4.2. Todos os processos

É a visão operacional consolidada.

Inclui:

- processos de campanhas;
- processos avulsos;
- individuais;
- familiares;
- confirmados;
- em andamento;
- cancelados;
- requerendo atenção;
- já efetivados.

Filtros recomendados:

- origem;
- campanha;
- período de destino;
- status;
- aluno;
- responsável;
- turma atual;
- turma futura;
- individual ou familiar;
- situação do contrato futuro;
- situação financeira futura.

### 4.3. Rematrícula avulsa

A rematrícula avulsa é o mesmo processo de domínio, apenas sem depender de campanha.

Conceitualmente:

```text
campaignId = opcional
origin = CAMPAIGN | STANDALONE
```

Ela deve estar disponível em três pontos:

1. página principal de rematrículas;
2. perfil do aluno;
3. perfil do responsável ou família.

Todos os pontos devem chamar o mesmo caso de uso.

---

## 5. Criação da campanha

### 5.1. Identificação

Campos recomendados:

- nome;
- descrição opcional;
- período de destino;
- data de início;
- data prevista de encerramento.

O período de destino deve ser obrigatório e real. O nome “Rematrículas 2027” não pode ser apenas um rótulo visual.

### 5.2. Público elegível

A escola pode definir critérios como:

- todas as matrículas ativas;
- turmas específicas;
- modalidades ou cursos;
- unidades;
- faixas etárias;
- contratos que terminam em determinado intervalo;
- alunos sem impedimentos específicos;
- inclusão manual;
- exclusão manual.

### 5.3. Regras da campanha

Possíveis configurações:

- permitir rematrícula individual;
- permitir rematrícula familiar;
- permitir confirmação parcial de filhos;
- reservar vaga futura;
- exigir definição de turma antes da conclusão;
- exigir contrato;
- exigir assinatura antes da conclusão;
- política da taxa de rematrícula;
- política de pendências financeiras;
- prazo para resposta;
- prazo para edição;
- janela de provisionamento financeiro;
- regra para rascunhos ao encerrar a campanha;
- regra para lista de espera.

O MVP pode começar com padrões definidos pela Alusa, evitando excesso de configuração inicial.

### 5.4. Ciclo de vida da campanha

```text
DRAFT
SCHEDULED
ACTIVE
PAUSED
CLOSED
ARCHIVED
```

Na interface:

- Rascunho;
- Agendada;
- Ativa;
- Pausada;
- Encerrada;
- Arquivada.

#### Rascunho

Ainda pode ser configurada livremente.

#### Agendada

Possui data futura de ativação.

#### Ativa

Aceita novos processos e respostas.

#### Pausada

Recomendação:

- não iniciar novos processos;
- não aceitar respostas externas;
- manter consulta;
- permitir trabalho interno autorizado;
- suspender comunicações automáticas.

#### Encerrada

Recomendação:

- não aceitar novas adesões;
- preservar rematrículas confirmadas;
- preservar reservas, contratos e financeiro futuro;
- manter pendências históricas;
- permitir regras configuráveis para rascunhos existentes.

#### Arquivada

Somente consulta histórica.

---

## 6. Participantes e elegibilidade

### 6.1. Fotografia inicial

Ao ativar a campanha, a Alusa deve registrar os participantes inicialmente elegíveis.

Para cada participante, registrar conceitualmente:

- `contaId`;
- matrícula ou vínculo de origem;
- aluno;
- responsável ou titular;
- turma atual;
- contrato atual;
- data de encerramento atual;
- motivo da elegibilidade;
- snapshot dos dados considerados;
- data de inclusão;
- origem da inclusão.

### 6.2. Revalidação

A fotografia inicial não deve ser tratada como verdade permanente.

A elegibilidade deve ser revalidada:

- antes de iniciar a rematrícula;
- antes de gerar o preview;
- antes de confirmar;
- antes da transição efetiva.

Revalidar:

- matrícula ainda existente e válida;
- vínculo pertencente à mesma `contaId`;
- contrato atual;
- período de destino;
- inexistência de rematrícula duplicada;
- situação da turma;
- capacidade;
- conflitos;
- elegibilidade do plano;
- papéis jurídicos e financeiros;
- bloqueios definidos pela escola.

### 6.3. Participantes que perdem elegibilidade

Não devem desaparecer silenciosamente.

Devem ficar marcados com motivo, por exemplo:

- matrícula cancelada;
- vínculo transferido;
- contrato alterado;
- turma cancelada;
- processo já existente;
- aluno removido da conta;
- vínculo já renovado em outra campanha.

### 6.4. Inclusão e exclusão depois da ativação

São ações diferentes:

```text
Adicionar participante
Excluir da campanha
Cancelar rematrícula
```

#### Adicionar participante

Revalida a elegibilidade e registra o motivo da inclusão posterior.

#### Excluir da campanha

Remove apenas do escopo gerencial, desde que não exista processo com efeitos relevantes.

#### Cancelar rematrícula

Cancela o processo de domínio e seus efeitos futuros.

---

## 7. Estrutura interna da campanha

Ao abrir uma campanha:

```text
Rematrículas 2027

[ Visão geral ]
[ Participantes ]
[ Pendências ]
[ Comunicação ]
[ Configurações ]
[ Histórico ]
```

### 7.1. Visão geral

Indicadores por vínculo/aluno:

- elegíveis;
- não iniciados;
- em andamento;
- confirmados;
- concluídos;
- não renovarão;
- requerem atenção.

Indicadores por família/responsável:

- famílias elegíveis;
- famílias não iniciadas;
- parcialmente concluídas;
- totalmente concluídas.

### 7.2. Participantes

Filtros recomendados:

```text
Todos
Não iniciados
Em andamento
Confirmados
Parciais
Requerem atenção
Não continuarão
Excluídos
```

O termo “Confirmados” é preferível a “Rematriculados” quando o próximo vínculo ainda não começou.

### 7.3. Pendências

Centraliza:

- turma futura indefinida;
- lista de espera;
- reserva expirada;
- contrato aguardando assinatura;
- plano familiar inválido;
- responsável sem contato;
- preço alterado;
- turma cancelada;
- conflito de horário;
- sobreposição de vigência;
- documentos faltantes;
- financeiro futuro com falha;
- alteração relevante no vínculo atual.

### 7.4. Comunicação

Pode ser adicionada gradualmente:

- convites;
- lembretes;
- mensagens segmentadas;
- histórico de contatos;
- comunicação pelo portal;
- falhas de entrega;
- consentimentos e preferências de canal.

### 7.5. Configurações

Mudanças depois do início da campanha devem:

- indicar processos impactados;
- criar nova versão;
- não alterar silenciosamente confirmações anteriores;
- exigir confirmação quando houver impacto material;
- registrar auditoria.

### 7.6. Histórico

Linha do tempo com:

- criação;
- ativação;
- pausas;
- alterações de regras;
- inclusão e exclusão de participantes;
- comunicações;
- encerramento;
- arquivamento.

---

## 8. Motor comum de rematrícula

A Alusa deve possuir um único motor de domínio:

```text
Motor de rematrícula antecipada
├── estratégia individual
└── estratégia familiar
```

O motor comum controla:

- elegibilidade;
- decisões;
- datas;
- matrícula futura;
- reserva;
- contrato;
- transição;
- alteração;
- cancelamento;
- idempotência;
- auditoria.

A estratégia específica controla principalmente a composição contratual e financeira.

### 8.1. Individual

Normalmente possui:

- um item de rematrícula;
- uma matrícula futura;
- um contrato futuro;
- um acordo financeiro;
- um pagador.

### 8.2. Familiar

Pode possuir:

- vários itens independentes;
- decisões diferentes por aluno ou vínculo;
- várias matrículas futuras;
- contratos conforme a regra jurídica;
- um acordo financeiro consolidado;
- uma assinatura compartilhada;
- regras mínimas de participantes.

---

## 9. Papéis jurídicos e financeiros

A Alusa não deve presumir que todas as funções pertencem à mesma pessoa.

Papéis:

```text
aluno acadêmico
solicitante
contratante
signatário
responsável financeiro
pagador
destinatário das notificações
```

### 9.1. Aluno menor

Normalmente:

```text
aluno: menor
contratante: responsável
signatário: responsável
pagador: responsável ou terceiro
```

### 9.2. Aluno maior de idade

Pode ser:

```text
aluno: próprio estudante
contratante: próprio estudante
signatário: próprio estudante
pagador: estudante ou terceiro
```

### 9.3. Aluno que completa 18 anos antes do próximo ciclo

Os papéis jurídicos devem ser avaliados considerando a idade em `effectiveAt`, e não apenas na data da campanha.

O sistema deve reavaliar:

- contratante futuro;
- signatário;
- pagador;
- necessidade de consentimento;
- dados contratuais.

---

## 10. Decisões por item de rematrícula

Decisões canônicas:

```text
RENEW
DECIDE_LATER
DO_NOT_CONTINUE
```

### 10.1. Rematricular

Pode produzir:

- reserva futura;
- matrícula futura;
- turma ou combo futuro;
- plano futuro;
- contrato futuro;
- acordo financeiro futuro;
- inclusão no próximo ciclo.

### 10.2. Decidir depois

Pode produzir somente:

- pendência operacional;
- prazo para decisão;
- registro de auditoria;
- comunicação futura.

Não pode produzir:

- matrícula futura;
- reserva;
- contrato;
- cobrança;
- assinatura;
- inclusão no plano familiar futuro;
- alteração do vínculo atual.

### 10.3. Não continuará

Pode produzir:

- decisão definitiva;
- motivo opcional;
- encerramento natural ao fim do contrato atual.

Não pode produzir próximo vínculo.

### 10.4. DTO discriminado

Somente `RENEW` pode possuir destino.

```ts
type RenewalItem =
  | {
      decision: "RENEW";
      sourceEnrollmentId: string;
      target: {
        type: "CLASS" | "COMBO";
        targetId: string;
        planId: string;
      };
    }
  | {
      decision: "DECIDE_LATER" | "DO_NOT_CONTINUE";
      sourceEnrollmentId: string;
      target: null;
    };
```

Ao mudar de `RENEW` para outra decisão:

- limpar turma futura;
- limpar combo futuro;
- limpar plano futuro;
- liberar reserva temporária;
- recalcular contrato e financeiro;
- ignorar qualquer campo residual no backend.

### 10.5. Zero confirmações

Quando nenhum item estiver em `RENEW`:

```text
não criar matrícula futura
não reservar vaga
não criar contrato
não criar acordo financeiro
não criar assinatura
não chamar Asaas
```

A ação deve ser:

> Salvar decisões

E não:

> Confirmar rematrícula

---

## 11. Estados canônicos

Não utilizar um único campo de status para representar tudo.

### 11.1. Estado da campanha

```text
DRAFT
SCHEDULED
ACTIVE
PAUSED
CLOSED
ARCHIVED
```

### 11.2. Estado do processo de rematrícula

Sugestão conceitual:

```text
DRAFT
PREVIEWED
PARTIALLY_CONFIRMED
CONFIRMED
WAITING_FOR_START
REQUIRES_ATTENTION
EFFECTIVE
CANCELLED
COMPLETED
```

Na interface:

- Não iniciado;
- Em andamento;
- Parcial;
- Confirmado;
- Aguardando início;
- Requer atenção;
- Não continuará;
- Cancelado;
- Novo ciclo iniciado.

### 11.3. Estado da decisão por item

```text
PENDING
RENEWED
DECIDE_LATER
DO_NOT_CONTINUE
CANCELLED
```

### 11.4. Estado da reserva

```text
NOT_RESERVED
RESERVED
WAITLISTED
EXPIRED
CANCELLED
CONVERTED
```

### 11.5. Estado da matrícula futura

```text
PREPARED
SCHEDULED
ACTIVE
CANCELLED
CLOSED
```

### 11.6. Estado do contrato futuro

```text
DRAFT
WAITING_SIGNATURE
SIGNED_SCHEDULED
ACTIVE
EXPIRED
CANCELLED
```

### 11.7. Estado do financeiro futuro

```text
NOT_PREPARED
SCHEDULED
READY_TO_PROVISION
PROVISIONING
ACTIVE
FAILED
CANCELLED
```

### 11.8. Estado acadêmico atual

```text
ACTIVE
CLOSED
CANCELLED
```

A matrícula atual deve continuar `ACTIVE` enquanto o vínculo atual estiver vigente.

---

## 12. Confirmação versus conclusão

“Confirmado” e “concluído” não devem significar a mesma coisa.

### 12.1. Decisão confirmada

O responsável ou a escola confirmou a permanência.

### 12.2. Vaga garantida

Existe reserva válida.

### 12.3. Contrato concluído

O contrato obrigatório foi assinado ou aceito conforme política.

### 12.4. Financeiro preparado

O acordo futuro está válido e pronto para provisionamento.

### 12.5. Processo concluído

Cumpriu todos os requisitos obrigatórios definidos pela campanha.

Padrão recomendado:

```text
Processo confirmado:
decisão + reserva

Processo concluído:
decisão + reserva + contrato exigido + requisitos obrigatórios
```

A campanha pode personalizar requisitos, mas a Alusa deve ter uma interpretação padrão.

---

## 13. Fluxo completo

### Etapa 1 — Identificação dos elegíveis

A campanha ou o fluxo avulso identifica vínculos válidos.

A tela deve mostrar:

```text
Contrato atual
Termina em 16 dias

Rematrícula
Disponível
```

A campanha antecipada não precisa depender da proximidade do encerramento.

### Etapa 2 — Início do processo

Criar rascunho associado a:

- `contaId`;
- campanha opcional;
- origem;
- período de destino;
- matrícula ou matrículas de origem;
- titular;
- versão dos dados atuais.

Nenhum efeito acadêmico ou financeiro definitivo ocorre nessa etapa.

### Etapa 3 — Decisões

Para cada item:

```text
Rematricular
Decidir depois
Não continuará
```

Somente `Rematricular` libera configuração do próximo vínculo.

### Etapa 4 — Configuração do futuro

Selecionar, conforme o caso:

- turma futura;
- combo futuro;
- plano futuro;
- papéis jurídicos;
- pagador;
- forma de pagamento futura;
- data efetiva;
- política de taxa;
- condições contratuais.

### Etapa 5 — Preview

O backend calcula tudo sem efeitos definitivos.

Deve validar:

- decisões;
- quantidade de renovados;
- período de destino;
- `effectiveAt`;
- capacidade;
- conflitos de horário;
- faixa etária;
- pré-requisitos;
- situação da turma;
- elegibilidade do plano;
- mínimo familiar;
- preço;
- taxa;
- papéis jurídicos;
- contrato atual;
- sobreposição;
- pagador;
- requisitos de assinatura;
- bloqueios e exceções.

Resposta conceitual:

```ts
{
  previewHash,
  sourceVersion,
  renewCount,
  pendingCount,
  nonRenewalCount,
  targetEnrollments,
  reservations,
  contracts,
  futureFinancialAgreement,
  monthlyTotal,
  enrollmentFeeTotal,
  effectiveAt,
  blockers,
  warnings
}
```

O frontend apresenta o resultado do servidor. Não recalcula as regras por conta própria.

### Etapa 6 — Revisão final

Exibir lado a lado:

```text
Vínculo atual
Turma atual
Contrato atual
Vigência atual
Financeiro atual

Próximo vínculo
Turma futura
Reserva
Contrato futuro
Financeiro futuro
Data de início
```

Exemplo:

```text
Vínculo atual
Ballet Matutino
Ativo até 04/07/2026

Próximo vínculo
Ballet Vespertino
Vaga reservada
Início em 05/07/2026

Contrato atual
Continua vigente

Contrato futuro
Assinado e agendado

Financeiro atual
Continua normalmente

Financeiro futuro
Inicia somente no próximo ciclo
```

### Etapa 7 — Confirmação

A confirmação deve executar uma única transação local.

Dentro da transação:

1. autenticar;
2. derivar `contaId` da sessão;
3. validar DTO com Zod;
4. validar `previewHash`;
5. validar `sourceVersion`;
6. bloquear registros relevantes;
7. verificar duplicidade;
8. revalidar capacidade e conflitos;
9. criar ou atualizar processo;
10. criar itens;
11. criar matrícula futura como `SCHEDULED`;
12. criar reserva futura;
13. criar contrato futuro;
14. criar acordo financeiro futuro;
15. registrar auditoria;
16. criar eventos de outbox quando necessário;
17. confirmar a transação.

Resultado:

```text
Rematrícula confirmada
Vaga reservada
Início agendado
```

Não:

```text
Matrícula ativa hoje
Turma atual alterada
Assinatura futura iniciada imediatamente
```

### Etapa 8 — Período de espera

Durante o intervalo:

- vínculo atual continua ativo;
- próximo vínculo pode ser consultado e editado;
- reserva conta na capacidade futura;
- contrato futuro pode ser assinado;
- financeiro futuro permanece agendado;
- alterações relevantes geram nova versão;
- inconsistências vão para `REQUIRES_ATTENTION`.

### Etapa 9 — Transição efetiva

Na data efetiva, um processo agendado revalida:

1. rematrícula ainda válida;
2. contrato atual encerrado;
3. ausência de sobreposição;
4. turma futura válida;
5. reserva existente;
6. política de assinatura;
7. bloqueios operacionais;
8. acordo financeiro futuro.

Na transação local:

```text
encerrar vínculo atual
converter reserva futura
ativar matrícula futura
ativar contrato futuro local
marcar processo como efetivado
registrar auditoria
criar outbox financeira
```

Depois:

```text
worker provisiona ou ativa financeiro
webhooks consolidam o estado local
```

---

## 14. Reserva de vaga

### 14.1. Ocupação atual e futura

A turma deve possuir duas visões de capacidade:

```text
ocupação atual
ocupação do próximo ciclo
```

Exemplo:

```text
Capacidade futura: 20
Vagas reservadas: 14
Vagas disponíveis: 6
```

Uma reserva futura:

- conta na capacidade do ciclo de destino;
- não torna o aluno ativo hoje;
- não entra na frequência atual;
- não entra no calendário atual.

### 14.2. Momento da reserva

Padrão recomendado:

- reservar ao confirmar a rematrícula;
- permitir política alternativa vinculada ao pagamento da taxa, se a escola desejar.

### 14.3. Dados da reserva

Conceitualmente:

- `contaId`;
- aluno;
- vínculo de origem;
- turma futura;
- período de destino;
- início previsto;
- prioridade;
- origem;
- data de confirmação;
- expiração opcional;
- status.

### 14.4. Alteração de turma futura

Ao alterar:

```text
liberar reserva antiga
→ validar nova turma
→ reservar nova vaga
→ atualizar matrícula futura
→ recalcular contrato
→ recalcular financeiro
→ exigir novo aceite quando material
→ auditar
```

### 14.5. Turma indisponível

Não escolher outra turma automaticamente.

O processo deve ir para:

```text
REQUIRES_ATTENTION
```

A escola pode:

- escolher outro destino;
- colocar em lista de espera;
- cancelar;
- oferecer alternativa.

---

## 15. Lista de espera

Quando a turma futura estiver lotada:

```text
Decisão: rematricular
Destino desejado: Ballet Vespertino
Reserva: WAITLISTED
Matrícula futura: ainda não garantida
```

A interface deve informar:

> Rematrícula confirmada, mas vaga ainda não garantida.

O processo não deve ser considerado concluído enquanto a política exigir vaga garantida.

Ao surgir uma vaga:

- revalidar elegibilidade;
- promover conforme prioridade;
- criar reserva;
- notificar;
- registrar auditoria.

---

## 16. Troca de turma

### 16.1. Regra temporal

Exemplo:

```text
Turma atual: Ballet Matutino
Fim atual: 04/07/2026

Turma futura: Ballet Vespertino
Início futuro: 05/07/2026
```

Até 04/07:

```text
Matutino: vínculo ativo
Vespertino: vaga reservada / vínculo agendado
```

Em 05/07:

```text
Matutino: vínculo encerrado
Vespertino: vínculo ativo
```

### 16.2. Exibição nas telas de turma

#### Turma atual

```text
Davi Oliveira
Ativo até 04/07/2026
Próximo ciclo: mudança confirmada para Vespertino
```

#### Turma futura

Em uma aba “Próximo ciclo”:

```text
Davi Oliveira
Vaga reservada
Entrada prevista: 05/07/2026
```

#### Histórico

Após a transição:

```text
Davi Oliveira
Vínculo encerrado em 04/07/2026
Destino: Ballet Vespertino
```

A matrícula futura nunca pode aparecer como ativa antes de `effectiveAt`.

### 16.3. Rematrícula versus transferência

São fluxos diferentes.

#### Rematrícula

- origem termina no fim do ciclo;
- destino começa no próximo ciclo.

#### Transferência

- origem termina durante o ciclo;
- destino começa imediatamente;
- pode exigir proporcionalidade financeira.

Não usar rematrícula para uma troca imediata de turma.

---

## 17. Contrato futuro

### 17.1. Contrato assinado não significa contrato vigente

O contrato futuro pode ser gerado e assinado meses antes.

Exemplo:

```text
Contrato atual
ACTIVE
até 04/07/2026

Contrato futuro
SIGNED_SCHEDULED
vigência a partir de 05/07/2026
```

### 17.2. Política de assinatura

A campanha deve definir:

- assinatura obrigatória ou não;
- assinatura necessária para reservar vaga ou concluir processo;
- prazo de assinatura;
- política na data de início;
- quem assina;
- quantidade de contratos no familiar.

### 17.3. Mudanças materiais

Exigem nova versão e novo aceite:

- troca de plano;
- alteração de valor;
- mudança de vigência;
- troca de unidade;
- inclusão ou exclusão de participante;
- alteração de contratante;
- mudança relevante de serviço ou turma.

Mudanças não materiais podem não exigir novo aceite:

- correção de telefone;
- observação interna;
- preferência de notificação.

Nunca substituir silenciosamente um contrato já assinado.

### 17.4. Contrato não assinado até o início

A escola deve escolher uma política:

- bloquear ativação;
- permitir com pendência;
- conceder prazo;
- cancelar reserva;
- exigir atuação da secretaria.

---

## 18. Financeiro futuro

### 18.1. Separação entre atual e futuro

A confirmação antecipada não deve:

- cancelar a assinatura atual;
- alterar valor atual;
- alterar vencimentos atuais;
- antecipar encerramento atual.

O acordo futuro deve ser local e separado.

### 18.2. Conteúdo do acordo futuro

- plano;
- valor;
- periodicidade;
- pagador;
- vencimento;
- forma de pagamento;
- multa;
- juros;
- desconto;
- início;
- término;
- regra de nota fiscal;
- participantes familiares;
- data de provisionamento.

### 18.3. Provisionamento no Asaas

Padrão recomendado:

- taxa pode ser provisionada na confirmação, conforme política;
- mensalidades futuras permanecem agendadas localmente;
- assinatura futura é provisionada em janela configurável.

Exemplo:

```text
Provisionar assinatura futura:
10 dias antes de effectiveAt
```

Antes de provisionar:

- revalidar contrato;
- revalidar pagador;
- revalidar valor;
- revalidar data;
- verificar cancelamento;
- verificar duplicidade.

### 18.4. Arquitetura financeira

Fluxo recomendado:

```text
transação local
→ entidade financeira futura SCHEDULED
→ externalReference
→ evento de outbox
→ commit

worker
→ chama Asaas
→ grava identificador externo

webhook
→ confirma estado
→ atualiza read model local
```

Os webhooks são a principal fonte de mudança de estado financeiro.

Consultas diretas ao Asaas devem ser usadas para:

- preflight;
- reconciliação;
- verificação;
- documentos oficiais;
- correção de divergência.

### 18.5. Falhas do Asaas

Separar:

```text
rematrícula acadêmica confirmada
financeiro futuro com provisionamento pendente
```

Toda operação externa deve possuir:

- idempotency key;
- external reference;
- outbox;
- retry;
- reconciliação;
- auditoria;
- consolidação por webhook.

Eventos não correlacionados não devem ser descartados definitivamente. Devem ficar pendentes para reprocessamento.

---

## 19. Taxa de rematrícula

A taxa deve ter política independente da mensalidade futura.

### 19.1. Momento da cobrança

```text
CHARGE_ON_CONFIRMATION
CHARGE_ON_START
EXEMPT
```

### 19.2. Unidade da taxa

```text
NO_FEE
PER_STUDENT
PER_FAMILY
```

### 19.3. Finalidade

```text
ADMINISTRATIVE_FEE
SEAT_RESERVATION
ADVANCE_FIRST_TUITION
```

Esses conceitos não devem ser misturados.

### 19.4. Regras adicionais

Definir:

- reembolso;
- parcelamento;
- isenção;
- abatimento da primeira mensalidade;
- efeito de troca de turma;
- efeito de cancelamento pela escola;
- efeito de desistência do responsável.

Se a taxa for cobrada na confirmação, isso não autoriza o início antecipado das mensalidades futuras.

---

## 20. Regras familiares

### 20.1. Decisões independentes

Exemplo:

```text
Maria Lúcia

Davi:
confirmado

Fernanda:
decidirá depois

Situação familiar:
Parcial — 1 de 2 confirmados
```

A família não pode ser marcada como totalmente concluída enquanto houver itens pendentes, salvo exclusão explícita dos demais vínculos.

### 20.2. Grupo futuro

O cálculo deve considerar o grupo futuro confirmado, não o grupo atual.

### 20.3. Todos confirmam

Criar grupo futuro com todos.

### 20.4. Apenas parte confirma

Recalcular:

- quantidade;
- elegibilidade;
- valor;
- desconto;
- taxa;
- cobrança futura.

### 20.5. Quantidade abaixo do mínimo

Bloquear:

> O Plano Familiar exige pelo menos dois participantes. Selecione outro plano ou confirme outro participante.

A Alusa não pode transformar silenciosamente um plano familiar de R$ 300 em R$ 150 para um aluno sem regra cadastrada.

### 20.6. Valor do grupo e rateio

Separar:

```text
valor total cobrado da família
rateio interno por aluno
```

Na matrícula, exibir algo como:

> Participante do Plano Familiar — valor total do grupo: R$ 300.

### 20.7. Datas diferentes entre irmãos

Cenário:

```text
Davi termina em 30/11
Fernanda termina em 31/12
```

Padrão recomendado para o primeiro fluxo estável:

- exigir um único início familiar;
- quando incompatível, solicitar alinhamento de datas ou processos individuais.

Não implementar entrada progressiva silenciosa no mesmo grupo financeiro sem regra explícita.

---

## 21. Rematrícula avulsa

Fluxo:

```text
Rematrícula avulsa
→ selecionar aluno ou responsável
→ selecionar vínculos de origem
→ selecionar período de destino
→ verificar campanha compatível
```

Se houver campanha:

> Este vínculo está elegível para a campanha “Rematrículas 2027”.

Ações:

- Vincular à campanha — recomendada;
- Continuar como avulsa.

Depois, usar exatamente o mesmo motor:

- decisões;
- preview;
- reserva;
- contrato;
- financeiro futuro;
- confirmação;
- transição.

“Avulsa” define apenas a origem administrativa.

---

## 22. Campanhas sobrepostas e duplicidade

A mesma matrícula pode aparecer em mais de uma campanha, mas não pode gerar dois processos para o mesmo destino.

Invariante:

```text
uma rematrícula ativa
por matrícula ou vínculo de origem
por período de destino
por contaId
```

Quando existir outro processo:

> Este vínculo já possui uma rematrícula em andamento para o período 2027.

Ações:

- abrir processo existente;
- referenciar o processo na campanha atual;
- excluir o participante;
- transferir associação, se autorizado.

Nunca criar duplicidade silenciosa.

---

## 23. Mudanças depois da confirmação

### 23.1. Edição do próximo ciclo

Pode alterar:

- turma futura;
- combo futuro;
- plano futuro;
- pagador futuro;
- forma de pagamento futura;
- participantes familiares;
- contrato futuro;
- data futura, quando autorizada.

Não pode alterar diretamente:

- matrícula atual;
- turma atual;
- contrato atual;
- assinatura atual;
- frequência atual.

### 23.2. Versionamento

Toda alteração relevante deve:

- gerar nova versão;
- registrar estado anterior e novo;
- revalidar vaga;
- recalcular contrato;
- recalcular financeiro;
- exigir novo aceite quando material;
- registrar autor, data e motivo.

### 23.3. Alterações no vínculo atual

Exemplos:

- transferência atual;
- cancelamento;
- prorrogação;
- encerramento antecipado;
- mudança de bolsa;
- mudança de pagador;
- saída de combo.

Toda alteração relevante deve disparar reavaliação do processo futuro.

O sistema não deve alterar o futuro silenciosamente.

### 23.4. Alterações nas condições futuras

Exemplos:

- turma cancelada;
- horário alterado;
- capacidade reduzida;
- plano alterado;
- preço alterado;
- calendário alterado;
- contrato-modelo alterado.

Cada confirmação deve guardar snapshot das condições aceitas.

A Alusa deve classificar o impacto:

- sem impacto;
- exige revalidação;
- exige novo aceite;
- bloqueia o processo.

---

## 24. Mudanças no contrato atual

### 24.1. Encerramento antecipado

Não ativar automaticamente o próximo vínculo.

A escola deve decidir:

- antecipar o início;
- manter a data original;
- tratar como transferência;
- cancelar a rematrícula.

### 24.2. Prorrogação

Exemplo:

```text
Contrato atual prorrogado até 31/07
Próximo vínculo previsto para 05/07
```

A Alusa deve detectar sobreposição e exigir decisão.

Não alterar datas silenciosamente.

### 24.3. Rescisão por inadimplência

Não presumir automaticamente cancelamento ou ativação do próximo vínculo.

A política deve ser explícita.

---

## 25. Cancelamento e desistência

A rematrícula futura pode ser cancelada:

- pelo responsável;
- pela secretaria;
- por prazo;
- por falta de assinatura;
- por falta de pagamento;
- por cancelamento de turma;
- por duplicidade;
- por erro operacional.

Cancelar deve:

- cancelar matrícula futura;
- liberar reserva;
- cancelar contrato futuro;
- cancelar acordo financeiro futuro;
- cancelar cobranças futuras provisionadas;
- preservar matrícula atual;
- preservar contrato atual;
- preservar assinatura atual;
- registrar motivo e autor.

Regra obrigatória:

> Cancelar o futuro nunca cancela automaticamente o vínculo atual.

---

## 26. Pendências, inadimplência e exceções

### 26.1. Políticas de bloqueio

A escola pode configurar:

```text
Permitir normalmente
Permitir com aviso
Permitir com autorização
Bloquear confirmação
Bloquear reserva
Bloquear ativação futura
```

Pendências possíveis:

- mensalidades vencidas;
- documentos faltantes;
- contrato atual não assinado;
- cadastro incompleto;
- pendência disciplinar;
- material não devolvido;
- pendência administrativa.

Não codificar uma política única para todas as escolas.

### 26.2. Exceções manuais

Exemplos:

- reservar acima da capacidade;
- permitir inadimplente;
- aceitar exceção de plano familiar;
- confirmar sem documento;
- alterar após prazo;
- iniciar sem assinatura.

Toda exceção deve exigir:

- permissão específica;
- justificativa;
- autor;
- data;
- regra ignorada;
- impacto;
- auditoria.

---

## 27. Experiência da página de gestão

### 27.1. Abas recomendadas

```text
Todos
Disponíveis
Em andamento
Confirmadas
Requer atenção
Encerradas
```

### 27.2. Significado

#### Disponíveis

Elegíveis, mas ainda não iniciados.

#### Em andamento

- rascunho;
- decisão parcial;
- aguardando turma;
- aguardando plano;
- aguardando assinatura;
- aguardando responsável.

#### Confirmadas

- permanência confirmada;
- vaga reservada ou status equivalente;
- próximo vínculo agendado.

#### Requer atenção

- turma cancelada;
- plano inválido;
- contrato pendente;
- falha financeira;
- sobreposição;
- reserva expirada;
- mudança no vínculo atual.

#### Encerradas

- não continuará;
- canceladas;
- efetivadas;
- concluídas;
- históricas.

### 27.3. Botões por estado

```text
Iniciar rematrícula
Continuar
Ver rematrícula
Editar próximo ciclo
Resolver pendência
Ver decisão
```

Depois da confirmação, não exibir novamente “Rematricular”.

### 27.4. Linha familiar

Exemplo:

```text
Titular:
Maria Lúcia Gomes

Alunos:
Davi e Fernanda

Contrato atual:
termina em 16 dias

Rematrícula:
Parcial — 1 de 2 confirmados

Próximo início:
05/07/2026

Ação:
Ver rematrícula
```

### 27.5. Linha individual

```text
Aluno:
Nicole de Alencar

Contrato atual:
termina em 16 dias

Rematrícula:
Confirmada — vaga reservada

Próximo início:
05/07/2026

Ação:
Ver rematrícula
```

---

## 28. Portal do responsável e do aluno

O domínio deve suportar:

- secretaria;
- portal do responsável;
- portal do aluno maior.

A API e os casos de uso devem ser os mesmos, alterando apenas:

- ator;
- permissões;
- etapas de confirmação;
- experiência de interface.

Definir:

- quem pode iniciar;
- quem pode escolher turma;
- quem pode escolher plano;
- salvamento de rascunho;
- renovação parcial dos filhos;
- edição depois da confirmação;
- cancelamento;
- validade de links;
- autenticação do aluno maior.

---

## 29. Comunicação

Eventos possíveis:

- campanha aberta;
- convite enviado;
- lembrete;
- prazo próximo;
- contrato disponível;
- contrato assinado;
- taxa criada;
- taxa vencida;
- vaga reservada;
- entrada em lista de espera;
- turma alterada;
- pendência;
- campanha prorrogada;
- rematrícula confirmada;
- processo concluído;
- início próximo.

Definir:

- destinatário;
- canal;
- template;
- consentimento;
- limite de envios;
- histórico;
- falha de entrega.

### 29.1. Sem resposta

Distinguir:

```text
Não iniciado
Convite enviado
Visualizado
Em andamento
Sem resposta
Prazo expirado
```

Não converter automaticamente “sem resposta” em “não continuará” sem política explícita.

---

## 30. Permissões

Definir quem pode:

- criar campanha;
- ativar;
- pausar;
- encerrar;
- editar regras;
- incluir participantes;
- excluir participantes;
- conceder exceções;
- alterar turma futura;
- alterar plano;
- alterar pagador;
- isentar taxa;
- cancelar rematrícula;
- reabrir processo;
- forçar ativação;
- resolver pendência financeira.

Separar permissões acadêmicas, administrativas, contratuais e financeiras.

---

## 31. Auditoria e histórico

Registrar:

- quem iniciou;
- quem confirmou;
- canal de confirmação;
- decisões anteriores;
- mudanças de turma;
- mudanças de plano;
- mudanças de preço;
- mudanças de pagador;
- exceções;
- justificativas;
- contratos gerados;
- comunicações;
- cancelamentos;
- ativações;
- falhas financeiras;
- reprocessamentos.

Nunca sobrescrever decisões importantes sem preservar a versão anterior.

Uma linha do tempo deve estar disponível no processo.

---

## 32. Idempotência, concorrência e isolamento

### 32.1. Invariantes de unicidade

```text
uma rematrícula ativa por vínculo de origem e período de destino
um item por vínculo dentro do processo
uma matrícula futura por origem e período
uma reserva por aluno, turma e ciclo
uma idempotencyKey por conta e ação
uma externalReference financeira única por conta
um acordo familiar ativo por grupo e ciclo
```

### 32.2. Confirmação segura

Usar:

- transação;
- bloqueio dos registros relevantes;
- `sourceVersion`;
- `previewHash`;
- idempotência;
- revalidação no servidor;
- tratamento de retry.

Duas secretárias não podem criar duas rematrículas para o mesmo vínculo.

### 32.3. Multi-tenant

Todos os objetos devem possuir ou ser resolvidos dentro de `contaId`:

- campanhas;
- participantes;
- processos;
- itens;
- matrículas;
- reservas;
- turmas;
- contratos;
- acordos financeiros;
- cobranças;
- outbox;
- auditoria.

O backend não deve confiar em `contaId` enviado pelo cliente. Deve derivá-lo da sessão e validar todas as relações.

---

## 33. Preview e commit

### 33.1. Preview canônico

O servidor deve ser a única fonte do resumo.

Deve retornar:

- quantidades;
- valores;
- reservas;
- contratos;
- financeiro futuro;
- alertas;
- bloqueios;
- `previewHash`;
- `sourceVersion`.

### 33.2. Commit

O commit deve enviar:

- `previewHash`;
- `sourceVersion`;
- `idempotencyKey`;
- decisões canônicas.

O backend deve rejeitar quando:

- origem mudou;
- vaga acabou;
- plano mudou;
- turma foi cancelada;
- contrato atual mudou;
- decisão mudou;
- quantidade exibida diverge;
- existe processo concorrente;
- preview expirou.

---

## 34. Máquina de estados, comandos e eventos

### 34.1. Comandos

```text
CreateCampaign
ScheduleCampaign
ActivateCampaign
PauseCampaign
CloseCampaign
ArchiveCampaign
AddParticipant
ExcludeParticipant
StartRenewal
SaveDecision
GeneratePreview
ConfirmRenewal
EditFutureLink
CancelRenewal
ResolvePendingIssue
ActivateFutureCycle
```

### 34.2. Eventos

```text
CampaignCreated
CampaignActivated
CampaignPaused
CampaignClosed
ParticipantAdded
ParticipantExcluded
RenewalStarted
DecisionRecorded
RenewalConfirmed
SeatReserved
WaitlistJoined
FutureContractPrepared
FutureFinanceScheduled
RenewalChanged
RenewalCancelled
FutureCycleActivated
```

### 34.3. Invariantes

```text
Nenhum vínculo futuro fica ativo antes de effectiveAt.

Nenhuma decisão pendente cria matrícula, reserva, contrato ou financeiro.

Nenhuma campanha cria uma segunda rematrícula para o mesmo vínculo e período.

Nenhum cancelamento futuro altera o vínculo atual.

Nenhuma mudança material ocorre sem nova versão e auditoria.

Nenhuma matrícula futura ativa pode coexistir com a origem ativa em sobreposição inválida.

Nenhum financeiro recorrente futuro deve iniciar antes da vigência definida.
```

---

## 35. Rotina de ativação

A ativação deve ser idempotente.

Resultado por item:

```text
EFFECTIVE
BLOCKED
NOT_ELIGIBLE
REQUIRES_ATTENTION
ALREADY_EFFECTIVE
```

Cenários que bloqueiam:

- contrato atual ainda ativo;
- turma futura cancelada;
- reserva inexistente;
- contrato futuro não assinado, conforme política;
- plano removido;
- valor alterado sem aceite;
- pagador inválido;
- duplicidade;
- aluno transferido;
- vínculo futuro cancelado.

Não executar parcialmente sem registrar exatamente o que ocorreu.

---

## 36. Rotinas de integridade

A Alusa deve detectar periodicamente:

- matrícula futura ativa antes da data;
- vínculo atual e futuro ativos com sobreposição inválida;
- reserva sem processo;
- processo confirmado sem matrícula futura;
- contrato futuro sem item;
- financeiro ativo antes da vigência;
- rematrícula duplicada;
- plano familiar abaixo do mínimo;
- cobrança sem pagador;
- processo efetivado com vínculo atual ainda ativo;
- campanha encerrada com operações inconsistentes;
- itens com `contaId` incoerente;
- contrato assinado divergente do snapshot atual;
- webhook financeiro sem correlação.

Essas verificações devem gerar pendências administrativas, não correções silenciosas.

---

## 37. Indicadores

Definições estáveis:

```text
Elegíveis:
participantes válidos da campanha

Confirmados:
itens com decisão RENEW confirmada

Concluídos:
processos que cumpriram os requisitos obrigatórios

Conversão:
confirmados / elegíveis

Conclusão:
concluídos / elegíveis
```

Separar métricas por:

- alunos;
- vínculos;
- responsáveis;
- famílias;
- vagas reservadas;
- receita futura prevista;
- taxas recebidas;
- contratos assinados;
- processos com pendência.

Nunca misturar receita prevista com receita recebida.

---

## 38. Organização sugerida no monorepo

### `packages/domain`

- decisões;
- estados;
- vigências;
- elegibilidade;
- regras familiares;
- capacidade;
- conflitos;
- validação de transição;
- cancelamento;
- máquina de estados;
- invariantes.

### `packages/lib`

- orquestração acadêmica;
- campanhas;
- participantes;
- matrículas futuras;
- reservas;
- contratos;
- ativação;
- auditoria;
- read models operacionais.

### `packages/finance`

- acordo financeiro futuro;
- taxa;
- outbox;
- provisionamento;
- reconciliação;
- cancelamentos;
- webhooks;
- retries;
- tratamento de eventos não correlacionados.

### `packages/asaas`

- cliente HTTP tipado;
- customers;
- cobranças;
- assinaturas;
- cancelamentos;
- consultas de verificação;
- contratos de integração.

### `apps/web`

- telas;
- wizard;
- Route Handlers;
- DTOs;
- autenticação;
- resolução de `contaId`;
- apresentação de estados;
- filtros;
- experiência do portal.

As rotas devem:

```text
autenticar
resolver contaId
validar DTO
chamar caso de uso
formatar resposta
```

As regras centrais não devem ficar acopladas às telas ou rotas.

---

## 39. Modelo conceitual de dados

Os nomes abaixo são sugestões conceituais, não afirmação de tabelas existentes.

```text
Campaign
├── contaId
├── targetPeriodId
├── rules
├── audienceDefinition
├── status
└── version

CampaignParticipant
├── contaId
├── campaignId
├── sourceEnrollmentId
├── eligibilitySnapshot
├── eligibilityReason
├── status
└── includedAt

RenewalProcess
├── contaId
├── campaignId opcional
├── origin
├── targetPeriodId
├── holderType
├── holderId
├── status
├── sourceVersion
├── previewHash
└── version

RenewalItem
├── contaId
├── renewalProcessId
├── sourceEnrollmentId
├── decision
├── targetEnrollmentId opcional
├── targetClassId opcional
├── targetPlanId opcional
├── effectiveAt
└── status

FutureSeatReservation
FutureContract
FutureFinancialAgreement
RenewalAuditLog
RenewalOutbox
```

---

## 40. Testes mínimos

### 40.1. Temporalidade

- campanha cinco meses antes;
- campanha três meses antes;
- campanha próxima ao fim;
- confirmação sem alterar vínculo atual;
- ativação somente em `effectiveAt`;
- contrato atual prorrogado;
- contrato atual encerrado antecipadamente.

### 40.2. Decisões

- todos renovam;
- ninguém renova;
- todos decidem depois;
- combinação das decisões;
- renovar para decidir depois;
- renovar para não continuar;
- zero renovados sem efeitos.

### 40.3. Acadêmico

- mesma turma;
- troca de turma;
- turma para combo;
- combo para turma;
- várias atividades independentes;
- conflito de horário;
- turma lotada;
- lista de espera;
- turma cancelada;
- edição de destino;
- cancelamento;
- histórico preservado.

### 40.4. Familiar

- todos confirmados;
- confirmação parcial;
- mínimo familiar não atingido;
- mudança para individual;
- inclusão posterior de irmão;
- exclusão de participante;
- taxa por aluno;
- taxa por família;
- datas incompatíveis.

### 40.5. Jurídico

- menor com responsável;
- maior contratando e pagando;
- maior com terceiro pagador;
- aluno que completa 18 anos antes da vigência;
- contrato assinado antecipadamente;
- contrato não assinado na data;
- mudança material exigindo novo aceite.

### 40.6. Financeiro

- taxa na confirmação;
- taxa no início;
- mensalidade apenas no próximo ciclo;
- falha do Asaas;
- timeout após criação externa;
- webhook antecipado;
- webhook duplicado;
- evento não correlacionado;
- retry de worker;
- cancelamento antes do provisionamento;
- cancelamento depois do provisionamento.

### 40.7. Concorrência

- clique duplo;
- reenvio da mesma requisição;
- duas secretárias;
- preview expirado;
- vaga ocupada entre preview e confirmação;
- campanhas sobrepostas;
- campanha e avulsa concorrentes.

### 40.8. Multi-tenant

- nenhum dado cruza `contaId`;
- nenhuma referência de turma, plano ou matrícula de outra conta é aceita;
- idempotência isolada por conta;
- auditoria isolada por conta.

### 40.9. E2E com Playwright

- criar campanha;
- ativar;
- iniciar processo;
- salvar rascunho;
- gerar preview;
- confirmar individual;
- confirmar familiar parcial;
- consultar confirmados;
- editar próximo ciclo;
- cancelar;
- resolver pendência;
- efetivar transição simulada.

---

## 41. Migração e saneamento dos dados atuais

Antes de liberar o novo fluxo:

- identificar matrículas futuras criadas como ativas;
- identificar sobreposição entre vínculos atuais e futuros;
- identificar cobranças futuras criadas antecipadamente;
- identificar processos com zero alunos e efeitos financeiros;
- identificar contratos futuros ausentes;
- identificar duplicidades;
- identificar planos familiares abaixo do mínimo;
- identificar webhooks sem correlação;
- preservar auditoria.

Correções automáticas devem ser limitadas a casos seguros.

Casos ambíguos devem gerar revisão manual.

---

## 42. Ordem recomendada de implementação

### Fase 1 — Bloqueios críticos

- impedir matrícula futura ativa antes da data;
- impedir efeitos com zero confirmações;
- limpar destino ao mudar decisão;
- impedir duplicidade;
- preservar matrícula, contrato e assinatura atuais;
- separar status acadêmico de status da rematrícula.

### Fase 2 — Modelo temporal

- período de destino;
- `effectiveAt`;
- matrícula futura agendada;
- reserva futura;
- vigência de vínculo;
- histórico.

### Fase 3 — Campanhas

- criação;
- público;
- participantes;
- snapshot;
- revalidação;
- visão geral;
- filtros;
- campanhas sobrepostas.

### Fase 4 — Gestão operacional

- todos os processos;
- rematrícula avulsa;
- detalhes;
- edição versionada;
- cancelamento;
- pendências;
- indicadores;
- auditoria.

### Fase 5 — Contratos

- contrato futuro;
- assinatura antecipada;
- vigência futura;
- política de bloqueio;
- novo aceite para mudanças materiais.

### Fase 6 — Financeiro

- acordo futuro local;
- política de taxa;
- janela de provisionamento;
- outbox;
- worker;
- webhooks;
- reconciliação;
- retries.

### Fase 7 — Ativação automática

- job de transição;
- revalidações;
- operação transacional;
- tratamento de falhas;
- alertas;
- idempotência.

### Fase 8 — Portal e comunicação

- responsável;
- aluno maior;
- convites;
- lembretes;
- contratos;
- notificações;
- acompanhamento.

---

## 43. Critérios de aceite do fluxo

O fluxo estará coerente quando a Alusa garantir que:

1. a escola pode criar campanhas para qualquer período futuro;
2. a confirmação antecipada não altera a matrícula atual;
3. o aluno não troca de turma antes de `effectiveAt`;
4. a vaga futura pode ser reservada sem ativar o vínculo;
5. contrato futuro pode ser assinado sem se tornar vigente;
6. mensalidades futuras não começam antes da nova vigência;
7. taxa de rematrícula segue política independente;
8. individual e familiar usam o mesmo motor;
9. cada vínculo pode ter decisão própria;
10. “decidir depois” não cria efeitos;
11. “não continuará” preserva o vínculo atual até o fim;
12. zero confirmações não cria financeiro;
13. campanhas e avulsas não duplicam processos;
14. toda mudança material é versionada e auditada;
15. cancelamento futuro não afeta o atual;
16. ativação é idempotente;
17. webhooks consolidam o estado financeiro;
18. todas as operações respeitam `contaId`;
19. inconsistências são detectadas e encaminhadas para resolução;
20. histórico acadêmico, contratual e financeiro é preservado.

---

## 44. Síntese final

A estrutura definitiva é:

```text
Campanhas
= planejamento, público, comunicação e indicadores

Todos os processos
= operação consolidada e acompanhamento

Rematrícula avulsa
= exceção operacional sem criar outro domínio

Motor de rematrícula
= regra única para individual, familiar, menor e maior

Próximo vínculo
= matrícula, reserva, contrato e financeiro futuros

Transição efetiva
= encerramento seguro do atual e ativação do futuro
```

A regra central deve permanecer inviolável:

> **A escola pode realizar a campanha quando quiser. O responsável ou aluno confirma antecipadamente sua permanência. A Alusa reserva a vaga e prepara o próximo vínculo. A matrícula, a turma, o contrato e o financeiro atuais permanecem intactos. O novo ciclo somente entra em vigor na data efetiva definida, sem sobreposição, duplicidade ou perda de histórico.**

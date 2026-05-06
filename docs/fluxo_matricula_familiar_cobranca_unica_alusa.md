# Fluxo de Matrícula e Rematrícula Familiar com Cobrança Única na Alusa

## 1. Objetivo do documento

Este documento descreve a abordagem técnica recomendada para os fluxos de **matrícula familiar** e **rematrícula familiar** na Alusa, com foco na criação de **uma única cobrança financeira consolidada** para múltiplos alunos vinculados ao mesmo responsável ou grupo familiar.

O objetivo é evitar o comportamento incorreto em que o sistema gera uma cobrança para cada filho/aluno selecionado durante a matrícula ou rematrícula familiar. No fluxo correto, a Alusa deve permitir que vários alunos sejam matriculados ou rematriculados academicamente, mas que o financeiro seja consolidado em um único contrato, acordo financeiro, cobrança, assinatura ou parcelamento, conforme o plano escolhido pelo usuário.

Este documento considera a Alusa como um **ERP Educacional multi-tenant**, com forte integração financeira white label via Asaas. A entidade `Conta` é o tenant principal, e todos os dados operacionais, acadêmicos, financeiros e de integração devem ser isolados por `contaId`.

---

## 2. Contexto do problema

No fluxo atual de matrícula familiar, ao selecionar dois ou mais alunos da mesma família, o sistema pode gerar duas ou mais cobranças, normalmente uma por aluno. Esse comportamento costuma acontecer quando a lógica financeira está acoplada ao loop de criação de matrículas acadêmicas.

Exemplo de comportamento incorreto:

```ts
for (const aluno of alunosSelecionados) {
  await criarMatricula(aluno)
  await criarCobranca(aluno)
}
```

Nesse modelo, cada aluno matriculado dispara uma cobrança própria. Isso pode até fazer sentido em um fluxo individual ou em planos cobrados separadamente por aluno, mas não é adequado para uma matrícula familiar cujo plano escolhido representa um valor único para o grupo familiar.

O comportamento esperado é:

```txt
1 família / 1 responsável financeiro / N alunos / 1 plano / 1 cobrança consolidada
```

Ou seja:

```txt
Matrícula familiar
├─ Aluno 1 → matrícula acadêmica individual
├─ Aluno 2 → matrícula acadêmica individual
├─ Aluno 3 → matrícula acadêmica individual
└─ 1 contrato / 1 acordo financeiro / 1 cobrança ou assinatura
```

Na rematrícula, o problema é parecido, mas com mais contexto: já existem matrículas anteriores, contratos anteriores, cobranças anteriores, possíveis assinaturas ativas, inadimplência e histórico acadêmico. Portanto, a rematrícula familiar não deve simplesmente repetir a matrícula inicial. Ela deve renovar, migrar ou encerrar ciclos anteriores de forma controlada.

---

## 3. Princípio central da solução

A regra principal é:

> No modo familiar, os alunos geram vínculos acadêmicos individuais, mas a cobrança deve ser criada a partir de um agregado financeiro único.

Esse agregado pode ser modelado como:

- `MatriculaFamiliar`
- `RematriculaFamiliar`
- `Contrato`
- `AcordoFinanceiro`
- `GrupoMatricula`
- ou outra entidade equivalente definida na arquitetura da Alusa

O ponto mais importante é que a cobrança não deve nascer diretamente de cada `alunoId`. Ela deve nascer de uma entidade superior que represente o vínculo familiar, contratual ou financeiro.

Modelo recomendado para matrícula:

```txt
Cobranca
├─ contaId
├─ responsavelFinanceiroId
├─ origemTipo: MATRICULA_FAMILIAR
├─ origemId: matriculaFamiliarId
├─ planoId
├─ valorTotal
├─ status
└─ itens
   ├─ alunoId 1 / matriculaId 1
   ├─ alunoId 2 / matriculaId 2
   └─ alunoId 3 / matriculaId 3
```

Modelo recomendado para rematrícula:

```txt
Cobranca
├─ contaId
├─ responsavelFinanceiroId
├─ origemTipo: REMATRICULA_FAMILIAR
├─ origemId: rematriculaFamiliarId
├─ planoId
├─ periodoLetivoId
├─ valorTotal
├─ status
└─ itens
   ├─ alunoId 1 / novaMatriculaId 1 / matriculaAnteriorId 1
   ├─ alunoId 2 / novaMatriculaId 2 / matriculaAnteriorId 2
   └─ alunoId 3 / novaMatriculaId 3 / matriculaAnteriorId 3
```

Os itens da cobrança servem para rastreabilidade, auditoria, relatórios e detalhamento operacional, mas não devem criar cobranças independentes no Asaas.

---

## 4. Responsável como centro familiar e financeiro

Para a Alusa, faz sentido existir uma página própria do responsável, especialmente em fluxos familiares. O responsável não deve ser tratado apenas como um contato do aluno. Ele pode ser:

```txt
responsável cadastral
responsável financeiro
pagador no Asaas
usuário do portal
assinante de contratos
destinatário de notificações
titular das cobranças da família
```

A página do responsável deve funcionar como uma visão 360º da família:

```txt
Responsável
├─ Dados pessoais
├─ Dados de contato
├─ Alunos vinculados
├─ Matrículas da família
├─ Rematrículas
├─ Contratos
├─ Cobranças
├─ Assinaturas
├─ Parcelamentos
├─ Histórico financeiro
├─ Notificações enviadas
└─ Acesso ao portal
```

No fluxo familiar, essa página ajuda a escola a entender rapidamente:

```txt
Quem paga?
Quais alunos estão vinculados?
Quais matrículas estão ativas?
Quais alunos precisam de rematrícula?
Existe assinatura ativa?
Existe inadimplência?
Existe contrato pendente?
Quais cobranças estão abertas?
```

A página do aluno continua importante para a visão acadêmica individual:

```txt
Aluno
├─ dados cadastrais
├─ turma
├─ matrícula
├─ frequência
├─ aulas
├─ reposições
├─ evolução
└─ histórico acadêmico
```

A página do responsável deve concentrar o contexto familiar, contratual e financeiro:

```txt
Responsável
├─ alunos vinculados
├─ contratos
├─ cobranças
├─ assinaturas
├─ pagamentos
├─ notificações
└─ portal
```

Recomendação de navegação:

```txt
Cadastro
├─ Alunos
├─ Responsáveis
├─ Turmas
└─ Produtos/Planos

Matrículas
├─ Todas
├─ Nova matrícula
├─ Rematrículas
└─ Matrículas familiares

Cobranças
├─ Todas
├─ Avulsas
├─ Parcelamentos
├─ Assinaturas
└─ Meu dinheiro
```

Ações rápidas úteis na página do responsável:

```txt
+ Nova matrícula familiar
+ Iniciar rematrícula familiar
+ Criar cobrança avulsa
+ Criar contrato
+ Enviar acesso ao portal
+ Ver inadimplência
+ Ver histórico financeiro
```

### 4.1 Responsável não é necessariamente família

Em uma primeira versão, a Alusa pode usar o `Responsavel` como hub familiar. Porém, pensando em evolução, pode ser útil ter uma entidade `GrupoFamiliar` ou `Familia`.

Exemplo:

```txt
Familia / GrupoFamiliar
├─ responsáveis
│  ├─ mãe
│  ├─ pai
│  └─ avó
├─ alunos
└─ responsável financeiro principal
```

Isso cobre situações como:

```txt
Aluno tem mãe e pai cadastrados
Pai é responsável financeiro
Mãe recebe notificações acadêmicas
Avó paga uma cobrança específica
```

Recomendação prática:

```txt
Agora:
- criar uma boa página de responsável
- usar responsável financeiro como centro do fluxo familiar

Depois, se necessário:
- evoluir para GrupoFamiliar/Familia
- permitir múltiplos responsáveis com papéis diferentes
```

---

## 5. Separação entre acadêmico e financeiro

A matrícula e a rematrícula familiar devem ser divididas em duas responsabilidades complementares.

### 5.1 Responsabilidade acadêmica

Criar ou renovar as matrículas individuais dos alunos, respeitando:

- `contaId`
- aluno
- turma
- período letivo
- capacidade da turma
- conflitos de horário
- status acadêmico inicial
- vínculo com o grupo familiar
- vínculo com contrato ou acordo financeiro
- histórico da matrícula anterior, quando for rematrícula

Cada aluno deve ter matrícula acadêmica própria, pois cada um ocupa vaga, turma, frequência, aula, reposição e histórico acadêmico de forma individual.

### 5.2 Responsabilidade financeira

Criar uma única origem financeira para o grupo, respeitando:

- responsável financeiro
- plano escolhido
- valor consolidado
- modelo de cobrança
- vencimento
- contrato
- assinatura, parcelamento ou cobrança avulsa
- integração com o Asaas
- idempotência
- reconciliação
- webhooks

O financeiro deve enxergar a família como uma unidade de cobrança quando o plano escolhido for familiar ou quando a escola desejar consolidar cobranças de alunos sob o mesmo responsável.

A regra prática é:

```txt
Acadêmico: individual por aluno.
Financeiro: consolidado por responsável, contrato, matrícula familiar ou rematrícula familiar.
```

---

## 6. Fluxo recomendado de matrícula familiar

O fluxo técnico recomendado para matrícula familiar é:

```txt
1. Validar entrada da requisição com Zod
2. Validar isolamento por contaId
3. Validar responsável financeiro
4. Validar alunos selecionados
5. Validar turmas e capacidade
6. Validar plano escolhido
7. Criar grupo de matrícula familiar
8. Criar matrículas acadêmicas individuais
9. Criar contrato ou acordo financeiro único
10. Calcular valor consolidado
11. Criar cobrança local única
12. Registrar evento de integração financeira em outbox
13. Worker/processador cria cobrança, assinatura ou parcelamento no Asaas
14. Webhooks do Asaas atualizam o estado financeiro local
15. Telas leem estado local/read model
```

Esse fluxo reduz acoplamento, evita duplicidade e respeita a regra arquitetural da Alusa: o estado financeiro deve ser conduzido principalmente pelos webhooks do Asaas, enquanto as telas devem consultar o estado local.

---

## 7. Fluxo recomendado de rematrícula familiar

A rematrícula familiar deve funcionar como uma renovação controlada do vínculo acadêmico e financeiro da família.

A regra central é:

```txt
Responsável com N alunos ativos
→ selecionar quais alunos serão rematriculados
→ definir turmas/planos do novo período
→ gerar novo contrato/acordo financeiro
→ criar cobrança, assinatura ou parcelamento consolidado
→ manter histórico da matrícula anterior
```

A rematrícula não deve simplesmente criar uma nova matrícula sem relação com a anterior. Ela deve preservar o histórico e indicar qual matrícula anterior foi renovada.

Modelo conceitual:

```txt
Responsável financeiro
├─ Aluno 1
│  ├─ Matrícula 2026
│  └─ Rematrícula 2027
├─ Aluno 2
│  ├─ Matrícula 2026
│  └─ Rematrícula 2027
└─ Acordo financeiro familiar 2027
   └─ 1 cobrança / 1 assinatura / 1 parcelamento
```

A rematrícula familiar deve nascer preferencialmente a partir da página do responsável:

```txt
Responsável → Alunos vinculados → Iniciar rematrícula familiar
```

### 7.1 Wizard recomendado para rematrícula

Fluxo de interface recomendado:

```txt
Etapa 1: Alunos elegíveis
Etapa 2: Turmas/período letivo
Etapa 3: Plano financeiro
Etapa 4: Contrato
Etapa 5: Revisão e confirmação
```

### 7.2 Etapa 1: alunos elegíveis

A tela deve mostrar todos os alunos vinculados ao responsável e permitir seleção parcial.

Exemplo:

```txt
Elaine Costa

Alunos vinculados:
[x] Bryan de Alencar Bezerra
[x] Nicole de Alencar Bezerra
[ ] Lara Bianca de Alencar
```

Nem sempre todos os filhos precisam ser rematriculados. Pode acontecer de:

```txt
- um aluno continuar
- outro sair da escola
- outro mudar de curso/turma
- outro entrar como novo aluno
```

Por isso, a rematrícula familiar precisa aceitar seleção parcial, desde que as regras do plano escolhido sejam respeitadas.

### 7.3 Etapa 2: novo período e novas turmas

Para cada aluno selecionado, a Alusa deve permitir definir:

- período letivo novo
- nova turma
- unidade, curso ou modalidade, se aplicável
- turno, se aplicável
- data de início

Também deve validar:

- turma pertence ao mesmo `contaId`
- turma pertence ao novo período letivo
- turma possui vaga
- aluno é elegível para a turma
- não existe outra matrícula/rematrícula do mesmo aluno no mesmo período

### 7.4 Etapa 3: plano financeiro

A Alusa deve permitir escolher o plano do novo ciclo:

```txt
Plano antigo: Plano Familiar Básico 2026
Plano novo: Plano Familiar Básico 2027
```

Ou:

```txt
Plano antigo: Familiar R$ 150,00
Plano novo: Por aluno R$ 120,00
Alunos: 2
Valor total: R$ 240,00
```

A troca de plano deve ser explícita e auditável.

### 7.5 Etapa 4: contrato

A rematrícula pode gerar:

- novo contrato
- aditivo contratual
- renovação do contrato anterior
- novo acordo financeiro

A escolha depende da estratégia jurídica e operacional da escola.

Recomendação para a Alusa:

```txt
Contrato anterior → encerrado ou mantido como histórico
Contrato novo/aditivo → vinculado à rematrícula familiar
Cobranças novas → vinculadas ao novo contrato/acordo
```

### 7.6 Etapa 5: revisão e confirmação

Antes de finalizar, o usuário deve ver:

```txt
Responsável financeiro: Elaine Costa
Novo período: 2027

Alunos rematriculados:
- Bryan → Turma Infantil A
- Nicole → Turma Juvenil B

Plano:
Plano Familiar Básico

Financeiro:
Cobranças que serão criadas: 1
Valor: R$ 150,00/mês
Taxa de rematrícula: R$ 80,00, se houver

Contrato:
Contrato 2027 pendente de assinatura
```

Essa revisão reduz erros operacionais e deixa claro que a cobrança é consolidada.

---

## 8. Situações de rematrícula familiar que devem ser previstas

### 8.1 Todos os alunos continuam no mesmo plano familiar

Exemplo:

```txt
Responsável: Elaine Costa
Alunos atuais: Bryan e Nicole
Plano atual: Plano Familiar Básico
Novo período: 2027
Valor: R$ 150,00/mês
```

Resultado esperado:

```txt
2 rematrículas acadêmicas
1 contrato/acordo familiar novo
1 assinatura/cobrança familiar nova ou renovada
```

Não devem nascer duas mensalidades separadas se o plano continua sendo familiar.

### 8.2 Apenas um dos alunos será rematriculado

Exemplo:

```txt
Bryan continua
Nicole não continua
```

A Alusa precisa verificar se o plano familiar ainda é válido.

Se o plano familiar exige pelo menos dois alunos, o sistema deve alertar:

```txt
Este plano familiar exige pelo menos 2 alunos.
Escolha outro plano ou adicione outro aluno à rematrícula.
```

Nesse caso, o fluxo pode migrar para plano individual:

```txt
1 rematrícula acadêmica
1 contrato individual
1 cobrança individual
```

### 8.3 Dois alunos continuam, mas em turmas diferentes

Isso é normal.

```txt
Bryan → Turma Infantil A
Nicole → Turma Juvenil B
```

Financeiramente, ainda pode ser:

```txt
1 plano familiar
1 cobrança consolidada
```

Academicamente:

```txt
2 rematrículas individuais
```

### 8.4 Plano mudou de familiar para por aluno

Exemplo:

```txt
Plano antigo: Familiar R$ 150,00
Plano novo: Por aluno R$ 120,00
Alunos: 2
```

A cobrança pode continuar consolidada, mas o cálculo muda:

```txt
2 alunos × R$ 120,00 = R$ 240,00
1 cobrança consolidada de R$ 240,00
```

Mesmo quando o plano é por aluno, para um mesmo responsável financeiro pode fazer sentido criar uma cobrança consolidada com itens, e não várias cobranças independentes, salvo regra explícita da escola.

### 8.5 Existe inadimplência anterior

Antes de permitir a rematrícula, a Alusa deve consultar o estado financeiro local do responsável:

```txt
Responsável possui cobranças vencidas?
Existe assinatura em atraso?
Existe acordo financeiro pendente?
Existe negociação em aberto?
```

A escola pode configurar políticas como:

```txt
- bloquear rematrícula com inadimplência
- permitir rematrícula com aviso
- permitir rematrícula se for gerado acordo de dívida
- exigir pagamento da taxa de rematrícula
- permitir somente mediante aprovação administrativa
```

A rematrícula não deve depender de consulta direta ao Asaas na tela como fonte principal. O ideal é a tela ler o estado financeiro local, atualizado por webhooks e reconciliação.

### 8.6 Taxa de rematrícula + mensalidade

Muito comum:

```txt
Taxa de rematrícula: R$ 80,00
Mensalidade familiar: R$ 150,00/mês
```

Resultado correto:

```txt
1 cobrança avulsa de taxa de rematrícula
1 assinatura mensal familiar
```

Isso são duas cobranças por naturezas financeiras diferentes, não por quantidade de filhos.

### 8.7 Rematrícula com parcelamento anual

Exemplo:

```txt
Contrato 2027: R$ 1.800,00
Parcelamento: 12x de R$ 150,00
Alunos: 2
```

Resultado esperado:

```txt
1 acordo financeiro familiar
1 parcelamento no provedor financeiro
12 parcelas vinculadas ao mesmo acordo
2 alunos vinculados como itens/rastreabilidade
```

Não deve ser criado um parcelamento para cada aluno, a menos que essa seja uma regra comercial explícita.

### 8.8 Rematrícula com assinatura anterior ativa

A assinatura anterior precisa ser tratada conforme a regra do novo ciclo.

Possibilidades:

```txt
1. Manter assinatura existente
2. Atualizar assinatura existente
3. Cancelar assinatura antiga e criar nova
4. Encerrar assinatura ao fim da competência e iniciar nova no próximo período
```

A escolha depende da política da escola e da capacidade de auditoria desejada.

Recomendação geral para histórico educacional:

```txt
Contrato 2026 → encerrado ou mantido como histórico
Assinatura 2026 → cancelada ou marcada para encerramento
Contrato 2027 → criado
Assinatura 2027 → criada
```

Essa abordagem costuma ser mais auditável, especialmente quando plano, valor, período letivo ou regras contratuais mudam.

---

## 9. Estrutura conceitual das entidades

Abaixo está uma sugestão conceitual. Os nomes exatos devem ser adaptados ao schema real do projeto.

### 9.1 Responsavel

Representa a pessoa responsável por alunos, podendo ter papéis diferentes.

Campos conceituais:

```prisma
model Responsavel {
  id              String   @id @default(cuid())
  contaId         String
  nome            String
  email           String?
  telefone        String?
  documento       String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([contaId])
}
```

Em uma evolução, os vínculos com alunos podem indicar papel:

```txt
RESPONSAVEL_FINANCEIRO
RESPONSAVEL_PEDAGOGICO
CONTATO_EMERGENCIA
RECEBE_NOTIFICACOES
```

### 9.2 MatriculaFamiliar ou GrupoMatricula

Representa o agregado acadêmico familiar no fluxo de matrícula inicial.

```prisma
model MatriculaFamiliar {
  id                         String   @id @default(cuid())
  contaId                    String
  responsavelFinanceiroId    String
  planoId                    String
  status                     String
  createdAt                  DateTime @default(now())
  updatedAt                  DateTime @updatedAt

  matriculas                 Matricula[]
  cobrancas                  Cobranca[]

  @@index([contaId])
  @@index([contaId, responsavelFinanceiroId])
}
```

### 9.3 RematriculaFamiliar

Representa o agregado de renovação familiar para um novo ciclo/período.

```prisma
model RematriculaFamiliar {
  id                         String   @id @default(cuid())
  contaId                    String
  responsavelFinanceiroId    String
  periodoLetivoAnteriorId    String?
  periodoLetivoNovoId        String
  planoAnteriorId            String?
  planoNovoId                String
  contratoAnteriorId         String?
  contratoNovoId             String?
  status                     String
  createdAt                  DateTime @default(now())
  updatedAt                  DateTime @updatedAt

  alunos                     RematriculaAluno[]
  cobrancas                  Cobranca[]

  @@index([contaId])
  @@index([contaId, responsavelFinanceiroId])
  @@index([contaId, periodoLetivoNovoId])
}
```

### 9.4 RematriculaAluno

Representa a renovação de cada aluno dentro da rematrícula familiar.

```prisma
model RematriculaAluno {
  id                       String   @id @default(cuid())
  contaId                  String
  rematriculaFamiliarId    String
  alunoId                  String
  matriculaAnteriorId      String
  novaMatriculaId          String?
  turmaAnteriorId          String?
  turmaNovaId              String
  status                   String
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt

  @@index([contaId])
  @@index([contaId, rematriculaFamiliarId])
  @@index([contaId, alunoId])
}
```

### 9.5 Matricula

Representa a matrícula acadêmica individual de cada aluno.

```prisma
model Matricula {
  id                       String   @id @default(cuid())
  contaId                  String
  alunoId                  String
  turmaId                  String
  periodoLetivoId          String?
  matriculaFamiliarId      String?
  rematriculaFamiliarId    String?
  matriculaAnteriorId      String?
  status                   String
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt

  @@index([contaId])
  @@index([contaId, alunoId])
  @@index([contaId, turmaId])
  @@index([contaId, matriculaFamiliarId])
  @@index([contaId, rematriculaFamiliarId])
  @@unique([contaId, alunoId, periodoLetivoId])
}
```

A constraint `@@unique([contaId, alunoId, periodoLetivoId])` ajuda a evitar que o mesmo aluno seja matriculado duas vezes no mesmo período.

### 9.6 Cobranca

Representa a cobrança local da Alusa, não apenas a cobrança do Asaas.

```prisma
model Cobranca {
  id                         String   @id @default(cuid())
  contaId                    String
  origemTipo                 String
  origemId                   String
  responsavelFinanceiroId    String
  planoId                    String?
  periodoLetivoId            String?
  competencia                String?
  valor                      Decimal
  vencimento                 DateTime
  status                     String
  asaasPaymentId             String?
  asaasSubscriptionId        String?
  asaasInstallmentId         String?
  idempotencyKey             String
  createdAt                  DateTime @default(now())
  updatedAt                  DateTime @updatedAt

  itens                      CobrancaItem[]

  @@index([contaId])
  @@index([contaId, origemTipo, origemId])
  @@unique([contaId, idempotencyKey])
}
```

### 9.7 CobrancaItem

Representa a composição interna da cobrança.

```prisma
model CobrancaItem {
  id                    String   @id @default(cuid())
  contaId               String
  cobrancaId            String
  alunoId               String?
  matriculaId           String?
  matriculaAnteriorId   String?
  descricao             String
  valor                 Decimal
  createdAt             DateTime @default(now())

  @@index([contaId])
  @@index([contaId, cobrancaId])
  @@index([contaId, alunoId])
}
```

No caso de plano familiar com valor único, os itens podem ter `valor = 0` apenas para rastreabilidade, ou podem receber rateio gerencial se a escola quiser relatórios por aluno. O importante é que esse rateio não gere cobranças separadas.

---

## 10. Onde a regra deve ficar no monorepo

A recomendação é não deixar essa lógica concentrada apenas na tela ou na rota API.

### 10.1 `apps/web`

Responsável por:

- UI do wizard de matrícula/rematrícula
- página do responsável
- coleta dos dados
- validação preliminar de formulário
- chamada para API interna
- feedback visual ao usuário

Não deve conter a regra principal de cálculo financeiro familiar.

### 10.2 `apps/web/app/api/...`

Responsável por:

- autenticação via NextAuth
- extração segura do `contaId`
- validação do DTO com Zod
- chamada do caso de uso
- retorno HTTP

Não deve implementar diretamente toda a regra de matrícula, rematrícula e cobrança.

### 10.3 `packages/domain`

Responsável por regras puras como:

- validação de capacidade
- conflitos de turma
- elegibilidade de matrícula
- elegibilidade de rematrícula
- vínculo familiar
- transição de período letivo
- máquina de estado acadêmica

### 10.4 `packages/finance`

Responsável por:

- cálculo do valor financeiro
- criação de acordo financeiro
- criação de cobrança local
- idempotência financeira
- outbox financeiro
- conciliação
- regras de assinatura, parcelamento e cobrança avulsa
- regras de renovação financeira na rematrícula

### 10.5 `packages/asaas`

Responsável por:

- cliente HTTP tipado do Asaas
- DTOs externos
- mapeamento de requests/responses
- tratamento de erros da API
- normalização de status externos

### 10.6 `packages/lib`

Pode conter serviços compartilhados, schemas comuns e utilidades de aplicação, desde que não vire um pacote genérico sem separação de responsabilidade.

---

## 11. DTOs de entrada recomendados

### 11.1 DTO para matrícula familiar

Um DTO para matrícula familiar deve representar explicitamente o tipo de vínculo e o plano escolhido.

```ts
import { z } from "zod"

export const criarMatriculaFamiliarSchema = z.object({
  contaId: z.string().min(1),
  responsavelFinanceiroId: z.string().min(1),
  tipoVinculo: z.literal("FAMILIAR"),
  planoId: z.string().min(1),
  vencimento: z.coerce.date(),
  alunos: z.array(
    z.object({
      alunoId: z.string().min(1),
      turmaId: z.string().min(1),
    })
  ).min(2, "Matrícula familiar exige pelo menos dois alunos."),
})

export type CriarMatriculaFamiliarInput = z.infer<
  typeof criarMatriculaFamiliarSchema
>
```

É importante que a matrícula familiar exija pelo menos dois alunos quando o plano escolhido exigir vínculo familiar. Caso haja apenas um aluno, o fluxo pode ser individual ou exigir troca de plano.

### 11.2 DTO para rematrícula familiar

A rematrícula precisa receber alunos selecionados, período novo, plano novo e vínculo com matrícula anterior.

```ts
import { z } from "zod"

export const criarRematriculaFamiliarSchema = z.object({
  contaId: z.string().min(1),
  responsavelFinanceiroId: z.string().min(1),
  periodoLetivoAnteriorId: z.string().min(1).optional(),
  periodoLetivoNovoId: z.string().min(1),
  planoId: z.string().min(1),
  vencimento: z.coerce.date(),
  cobrarTaxaRematricula: z.boolean().default(false),
  alunos: z.array(
    z.object({
      alunoId: z.string().min(1),
      matriculaAnteriorId: z.string().min(1),
      novaTurmaId: z.string().min(1),
    })
  ).min(1, "Selecione ao menos um aluno para rematrícula."),
})

export type CriarRematriculaFamiliarInput = z.infer<
  typeof criarRematriculaFamiliarSchema
>
```

Diferente da matrícula familiar inicial, a rematrícula pode permitir apenas um aluno selecionado, desde que o plano escolhido seja compatível. Se o plano for familiar e exigir dois ou mais alunos, a validação deve acontecer no caso de uso financeiro/domínio.

---

## 12. Caso de uso recomendado para matrícula familiar

Exemplo conceitual de caso de uso:

```ts
export async function criarMatriculaFamiliar(input: CriarMatriculaFamiliarInput) {
  const parsed = criarMatriculaFamiliarSchema.parse(input)

  return await prisma.$transaction(async (tx) => {
    const plano = await tx.plano.findFirstOrThrow({
      where: {
        id: parsed.planoId,
        contaId: parsed.contaId,
        ativo: true,
      },
    })

    const grupo = await tx.matriculaFamiliar.create({
      data: {
        contaId: parsed.contaId,
        responsavelFinanceiroId: parsed.responsavelFinanceiroId,
        planoId: plano.id,
        status: "PENDENTE_FINANCEIRO",
      },
    })

    const matriculas = []

    for (const aluno of parsed.alunos) {
      const matricula = await tx.matricula.create({
        data: {
          contaId: parsed.contaId,
          alunoId: aluno.alunoId,
          turmaId: aluno.turmaId,
          matriculaFamiliarId: grupo.id,
          status: "PENDENTE_FINANCEIRO",
        },
      })

      matriculas.push(matricula)
    }

    const valorTotal = calcularValorMatriculaFamiliar({
      plano,
      quantidadeAlunos: parsed.alunos.length,
      tipoVinculo: "FAMILIAR",
    })

    const idempotencyKey = criarIdempotencyKey({
      contaId: parsed.contaId,
      origemTipo: "MATRICULA_FAMILIAR",
      origemId: grupo.id,
      planoId: plano.id,
      vencimento: parsed.vencimento,
    })

    const cobranca = await tx.cobranca.create({
      data: {
        contaId: parsed.contaId,
        origemTipo: "MATRICULA_FAMILIAR",
        origemId: grupo.id,
        responsavelFinanceiroId: parsed.responsavelFinanceiroId,
        planoId: plano.id,
        valor: valorTotal,
        vencimento: parsed.vencimento,
        status: "AGUARDANDO_CRIACAO_ASAAS",
        idempotencyKey,
        itens: {
          create: matriculas.map((matricula) => ({
            contaId: parsed.contaId,
            alunoId: matricula.alunoId,
            matriculaId: matricula.id,
            descricao: "Aluno vinculado à matrícula familiar",
            valor: 0,
          })),
        },
      },
    })

    await tx.outboxEvent.create({
      data: {
        contaId: parsed.contaId,
        tipo: "CRIAR_COBRANCA_ASAAS",
        aggregateId: cobranca.id,
        payload: {
          cobrancaId: cobranca.id,
        },
      },
    })

    return {
      grupo,
      matriculas,
      cobranca,
    }
  })
}
```

O ponto essencial é que a cobrança é criada uma única vez, fora do loop de alunos.

---

## 13. Caso de uso recomendado para rematrícula familiar

A rematrícula familiar precisa validar matrículas anteriores e criar novas matrículas para o próximo período.

Fluxo técnico recomendado:

```txt
1. Receber responsável financeiro e alunos selecionados
2. Validar contaId
3. Buscar matrículas atuais dos alunos
4. Validar elegibilidade de rematrícula
5. Validar inadimplência conforme regra da escola
6. Validar novo período letivo
7. Validar novas turmas
8. Validar plano escolhido
9. Criar RematriculaFamiliar
10. Criar nova matrícula para cada aluno selecionado
11. Encerrar, concluir ou preservar matrícula anterior como histórica
12. Criar contrato/acordo financeiro novo ou renovar vínculo existente
13. Criar cobrança, assinatura ou parcelamento único
14. Registrar evento outbox para integração com Asaas
15. Aguardar webhooks para atualizar status financeiro
```

Exemplo conceitual:

```ts
export async function criarRematriculaFamiliar(input: CriarRematriculaFamiliarInput) {
  const parsed = criarRematriculaFamiliarSchema.parse(input)

  return await prisma.$transaction(async (tx) => {
    const alunoIds = parsed.alunos.map((aluno) => aluno.alunoId)

    const alunos = await tx.aluno.findMany({
      where: {
        contaId: parsed.contaId,
        id: { in: alunoIds },
      },
    })

    if (alunos.length !== parsed.alunos.length) {
      throw new Error("Um ou mais alunos não pertencem à conta informada.")
    }

    const matriculasAtuais = await tx.matricula.findMany({
      where: {
        contaId: parsed.contaId,
        id: { in: parsed.alunos.map((aluno) => aluno.matriculaAnteriorId) },
        alunoId: { in: alunoIds },
        status: "ATIVA",
      },
    })

    if (matriculasAtuais.length !== parsed.alunos.length) {
      throw new Error("Um ou mais alunos não possuem matrícula ativa elegível para rematrícula.")
    }

    const plano = await tx.plano.findFirstOrThrow({
      where: {
        id: parsed.planoId,
        contaId: parsed.contaId,
        ativo: true,
      },
    })

    validarPlanoParaQuantidadeDeAlunos({
      plano,
      quantidadeAlunos: parsed.alunos.length,
    })

    const rematriculaFamiliar = await tx.rematriculaFamiliar.create({
      data: {
        contaId: parsed.contaId,
        responsavelFinanceiroId: parsed.responsavelFinanceiroId,
        periodoLetivoAnteriorId: parsed.periodoLetivoAnteriorId,
        periodoLetivoNovoId: parsed.periodoLetivoNovoId,
        planoNovoId: plano.id,
        status: "PENDENTE_FINANCEIRO",
      },
    })

    const novasMatriculas = []

    for (const aluno of parsed.alunos) {
      const matriculaAnterior = matriculasAtuais.find(
        (matricula) => matricula.id === aluno.matriculaAnteriorId
      )

      if (!matriculaAnterior) {
        throw new Error("Matrícula anterior não encontrada para o aluno informado.")
      }

      const novaMatricula = await tx.matricula.create({
        data: {
          contaId: parsed.contaId,
          alunoId: aluno.alunoId,
          turmaId: aluno.novaTurmaId,
          periodoLetivoId: parsed.periodoLetivoNovoId,
          rematriculaFamiliarId: rematriculaFamiliar.id,
          matriculaAnteriorId: matriculaAnterior.id,
          status: "PENDENTE_FINANCEIRO",
        },
      })

      await tx.rematriculaAluno.create({
        data: {
          contaId: parsed.contaId,
          rematriculaFamiliarId: rematriculaFamiliar.id,
          alunoId: aluno.alunoId,
          matriculaAnteriorId: matriculaAnterior.id,
          novaMatriculaId: novaMatricula.id,
          turmaAnteriorId: matriculaAnterior.turmaId,
          turmaNovaId: aluno.novaTurmaId,
          status: "CRIADA",
        },
      })

      novasMatriculas.push(novaMatricula)
    }

    const valorTotal = calcularValorRematriculaFamiliar({
      plano,
      quantidadeAlunos: novasMatriculas.length,
      alunos: parsed.alunos,
    })

    const idempotencyKey = criarIdempotencyKeyRematricula({
      contaId: parsed.contaId,
      rematriculaFamiliarId: rematriculaFamiliar.id,
      planoId: plano.id,
      periodoLetivoId: parsed.periodoLetivoNovoId,
    })

    const cobranca = await tx.cobranca.create({
      data: {
        contaId: parsed.contaId,
        origemTipo: "REMATRICULA_FAMILIAR",
        origemId: rematriculaFamiliar.id,
        responsavelFinanceiroId: parsed.responsavelFinanceiroId,
        planoId: plano.id,
        periodoLetivoId: parsed.periodoLetivoNovoId,
        valor: valorTotal,
        vencimento: parsed.vencimento,
        status: "AGUARDANDO_CRIACAO_ASAAS",
        idempotencyKey,
        itens: {
          create: novasMatriculas.map((matricula) => ({
            contaId: parsed.contaId,
            alunoId: matricula.alunoId,
            matriculaId: matricula.id,
            matriculaAnteriorId: matricula.matriculaAnteriorId,
            descricao: "Rematrícula familiar",
            valor: 0,
          })),
        },
      },
    })

    await tx.outboxEvent.create({
      data: {
        contaId: parsed.contaId,
        tipo: "CRIAR_COBRANCA_ASAAS",
        aggregateId: cobranca.id,
        payload: {
          cobrancaId: cobranca.id,
        },
      },
    })

    return {
      rematriculaFamiliar,
      novasMatriculas,
      cobranca,
    }
  })
}
```

O ponto importante continua sendo:

```txt
O loop cria as novas matrículas acadêmicas.
A cobrança nasce uma única vez, fora do loop.
```

---

## 14. Regra de cálculo financeiro

A regra de cálculo não deve ficar espalhada pela UI. Ela deve estar isolada em domínio financeiro.

Exemplo simples:

```ts
export function calcularValorMatriculaFamiliar(params: {
  plano: {
    valor: number
    modeloCobranca: string
  }
  quantidadeAlunos: number
}) {
  if (params.plano.modeloCobranca === "VALOR_UNICO_FAMILIAR") {
    return params.plano.valor
  }

  if (params.plano.modeloCobranca === "POR_ALUNO") {
    return params.plano.valor * params.quantidadeAlunos
  }

  throw new Error("Modelo de cobrança não suportado para matrícula familiar.")
}
```

Para rematrícula:

```ts
export function calcularValorRematriculaFamiliar(params: {
  plano: {
    valor: number
    modeloCobranca: string
    taxaRematricula?: number | null
  }
  quantidadeAlunos: number
  incluirTaxaRematricula?: boolean
}) {
  let mensalidade = 0

  if (params.plano.modeloCobranca === "VALOR_UNICO_FAMILIAR") {
    mensalidade = params.plano.valor
  } else if (params.plano.modeloCobranca === "POR_ALUNO") {
    mensalidade = params.plano.valor * params.quantidadeAlunos
  } else {
    throw new Error("Modelo de cobrança não suportado para rematrícula familiar.")
  }

  const taxa = params.incluirTaxaRematricula
    ? params.plano.taxaRematricula ?? 0
    : 0

  return mensalidade + taxa
}
```

Uma modelagem mais flexível pode prever:

```ts
type ModeloCobrancaPlano =
  | "VALOR_UNICO_FAMILIAR"
  | "POR_ALUNO"
  | "COMBO"
  | "DESCONTO_PROGRESSIVO"
```

Com isso, a Alusa fica preparada para cenários como:

- família paga um valor único
- cada aluno tem preço individual
- irmãos recebem desconto progressivo
- combo inclui múltiplos cursos
- plano familiar tem limite de alunos
- aluno extra gera adicional
- rematrícula tem taxa inicial
- rematrícula reaproveita assinatura anterior

---

## 15. Situações de negócio da matrícula familiar

### 15.1 Plano familiar de valor único

Exemplo:

```txt
Plano Familiar Básico
Até 3 alunos
Valor: R$ 150,00/mês
```

Resultado esperado:

```txt
3 alunos matriculados
1 cobrança de R$ 150,00
```

### 15.2 Plano por aluno

Exemplo:

```txt
Mensalidade individual
Valor: R$ 150,00 por aluno
```

Resultado esperado:

```txt
3 alunos matriculados
1 cobrança consolidada de R$ 450,00
```

Mesmo nesse caso, pode ser melhor criar uma cobrança consolidada com três itens, em vez de três cobranças separadas, se o responsável financeiro for o mesmo e o fluxo for familiar.

### 15.3 Plano com desconto para irmãos

Exemplo:

```txt
1º aluno: R$ 150,00
2º aluno: R$ 120,00
3º aluno: R$ 100,00
```

Resultado esperado:

```txt
3 alunos matriculados
1 cobrança de R$ 370,00
```

Nesse caso, os itens podem registrar o rateio por aluno:

```txt
Aluno 1: R$ 150,00
Aluno 2: R$ 120,00
Aluno 3: R$ 100,00
Total: R$ 370,00
```

### 15.4 Taxa de matrícula separada da mensalidade

A escola pode cobrar:

- uma taxa de matrícula inicial
- uma mensalidade recorrente

Nesse caso, é aceitável criar mais de uma cobrança, mas não por causa da quantidade de alunos. A duplicidade deve vir da natureza financeira do contrato.

Exemplo correto:

```txt
Família Alencar
├─ 1 cobrança de taxa de matrícula
└─ 1 assinatura mensal
```

Exemplo incorreto:

```txt
Família Alencar
├─ taxa de matrícula do aluno 1
├─ taxa de matrícula do aluno 2
├─ mensalidade do aluno 1
└─ mensalidade do aluno 2
```

### 15.5 Assinatura mensal

Se o plano for recorrente, a Alusa deve criar uma única assinatura para o responsável financeiro.

Modelo:

```txt
Responsável financeiro → 1 customer Asaas
Matrícula familiar → 1 subscription Asaas
Alunos → vínculos internos da Alusa
```

As cobranças futuras da assinatura devem ser sincronizadas localmente por webhook ou rotina de reconciliação.

### 15.6 Parcelamento

Se a matrícula familiar gerar um parcelamento, o correto é criar um parcelamento único.

Exemplo:

```txt
Valor total: R$ 1.200,00
Parcelamento: 6x de R$ 200,00
Alunos: 2
```

Resultado esperado:

```txt
1 acordo financeiro
1 installment/parcelamento no Asaas
6 cobranças locais vinculadas ao mesmo acordo
```

Não deve ser criado um parcelamento para cada aluno, salvo se essa for uma regra comercial explícita e escolhida pela escola.

---

## 16. Integração com Asaas

No contexto da Alusa, o Asaas deve ser tratado como provedor financeiro white label. A escola não deve depender da interface do Asaas para operar o fluxo.

### 16.1 Customer

O `customer` do Asaas deve representar o responsável financeiro, não o aluno.

```txt
Responsável financeiro da Alusa → Customer no Asaas
```

Caso o responsável já tenha `asaasCustomerId`, a Alusa deve reutilizar esse identificador. Caso contrário, deve criar o customer antes de criar a cobrança.

### 16.2 Cobrança avulsa

Use quando a cobrança for única, como taxa de matrícula, taxa de rematrícula, material, evento, reposição cobrada ou cobrança pontual.

```txt
MatriculaFamiliar/RematriculaFamiliar → Cobranca local → Payment Asaas
```

### 16.3 Assinatura

Use quando o plano for recorrente.

```txt
MatriculaFamiliar/RematriculaFamiliar → Acordo financeiro local → Subscription Asaas
```

A Alusa deve manter o vínculo local com a assinatura e sincronizar as cobranças geradas pela recorrência.

### 16.4 Parcelamento

Use quando o plano ou contrato for pago em parcelas.

```txt
MatriculaFamiliar/RematriculaFamiliar → Acordo financeiro local → Installment Asaas
```

Cada parcela pode aparecer como cobrança local, mas todas vinculadas ao mesmo acordo financeiro.

### 16.5 Webhooks como fonte de verdade operacional

A Alusa deve evitar atualizar status financeiro com base apenas no retorno imediato da criação da cobrança.

O fluxo recomendado é:

```txt
1. Alusa cria cobrança local como AGUARDANDO_CRIACAO_ASAAS
2. Worker envia request ao Asaas
3. Alusa salva identificadores externos retornados
4. Webhook confirma criação, pagamento, vencimento, cancelamento ou estorno
5. Read models locais alimentam as telas
```

Consultas diretas ao Asaas devem ser usadas para:

- preflight
- reconciliação
- correção de divergência
- consulta de documento oficial
- reprocessamento
- auditoria

---

## 17. O que fazer com a assinatura anterior na rematrícula

A rematrícula pode envolver uma assinatura já existente. A decisão deve ser explícita, auditável e baseada na política da escola.

### 17.1 Assinatura continua igual

Se plano, valor, vencimento, responsável financeiro e regras contratuais continuam iguais, a Alusa pode manter a assinatura existente.

```txt
Rematrícula 2027
→ mantém assinatura Asaas existente
→ cria novo vínculo local com o novo período
```

Essa abordagem é boa quando o contrato é contínuo e a escola não precisa de uma nova assinatura por período letivo.

### 17.2 Plano ou valor mudou

Se plano, valor, vencimento ou contrato mudaram, existem opções:

```txt
- atualizar a assinatura existente, se a regra permitir
- cancelar a assinatura antiga e criar uma nova
- criar nova assinatura a partir da próxima competência
- manter assinatura antiga até o fim do ciclo e iniciar outra depois
```

Recomendação mais auditável:

```txt
Contrato 2026 → encerrado
Assinatura 2026 → cancelada ou marcada para encerrar
Contrato 2027 → criado
Assinatura 2027 → criada
```

Isso facilita histórico, suporte, auditoria, relatórios e reconciliação.

### 17.3 Taxa de rematrícula + mensalidade recorrente

Quando houver taxa inicial e mensalidade recorrente:

```txt
Rematrícula familiar
├─ 1 cobrança avulsa de taxa de rematrícula
└─ 1 assinatura mensal familiar
```

Novamente, o número de cobranças nasce da natureza financeira, não da quantidade de alunos.

---

## 18. Idempotência e prevenção de duplicidade

A matrícula e a rematrícula familiar são fluxos sensíveis porque podem sofrer:

- clique duplo no botão finalizar
- retry automático do frontend
- timeout na rota API
- falha parcial na integração com Asaas
- reprocessamento de job
- duplicidade de webhook
- usuário voltando etapas do wizard

Por isso, a cobrança precisa ter chave de idempotência.

Exemplo para matrícula:

```ts
export function criarIdempotencyKey(params: {
  contaId: string
  origemTipo: string
  origemId: string
  planoId: string
  vencimento: Date
}) {
  return [
    params.contaId,
    params.origemTipo,
    params.origemId,
    params.planoId,
    params.vencimento.toISOString().slice(0, 10),
  ].join(":")
}
```

Exemplo para rematrícula:

```ts
export function criarIdempotencyKeyRematricula(params: {
  contaId: string
  rematriculaFamiliarId: string
  planoId: string
  periodoLetivoId: string
}) {
  return [
    params.contaId,
    "REMATRICULA_FAMILIAR",
    params.rematriculaFamiliarId,
    params.planoId,
    params.periodoLetivoId,
  ].join(":")
}
```

Constraint recomendada:

```prisma
@@unique([contaId, idempotencyKey])
```

Também pode ser útil:

```prisma
@@unique([contaId, origemTipo, origemId])
```

Ou, para mensalidades por competência:

```prisma
@@unique([contaId, origemTipo, origemId, competencia])
```

A escolha depende do modelo real:

- cobrança única da matrícula: unique por origem
- taxa de rematrícula: unique por origem + tipo de cobrança
- mensalidade recorrente: unique por origem + competência
- parcelamento: unique por origem + número da parcela

---

## 19. Outbox financeiro

Para evitar inconsistências entre banco local e Asaas, é recomendável usar o padrão Outbox.

### 19.1 Por que usar outbox

Sem outbox, um erro após criar matrícula/rematrícula mas antes de chamar o Asaas pode deixar o sistema em estado parcial.

Com outbox:

```txt
Transação local:
├─ cria grupo familiar ou rematrícula familiar
├─ cria matrículas acadêmicas
├─ cria cobrança local
└─ registra evento CRIAR_COBRANCA_ASAAS

Processamento assíncrono:
└─ worker lê evento e cria cobrança no Asaas com idempotência
```

Assim, a Alusa mantém rastreabilidade e pode reprocessar eventos com segurança.

### 19.2 Exemplo de evento

```ts
await tx.outboxEvent.create({
  data: {
    contaId,
    tipo: "CRIAR_COBRANCA_ASAAS",
    aggregateId: cobranca.id,
    payload: {
      cobrancaId: cobranca.id,
    },
    status: "PENDENTE",
  },
})
```

O worker deve:

1. buscar a cobrança local
2. validar `contaId`
3. buscar credenciais/subconta Asaas da conta
4. garantir customer do responsável
5. criar payment/subscription/installment
6. salvar identificadores externos
7. marcar evento como processado
8. registrar logs e auditoria

---

## 20. Status recomendados

### 20.1 Status acadêmico da matrícula

```ts
type MatriculaStatus =
  | "RASCUNHO"
  | "PENDENTE_FINANCEIRO"
  | "ATIVA"
  | "CONCLUIDA"
  | "CANCELADA"
  | "TRANCADA"
```

### 20.2 Status da rematrícula familiar

```ts
type RematriculaFamiliarStatus =
  | "RASCUNHO"
  | "EM_REVISAO"
  | "PENDENTE_CONTRATO"
  | "PENDENTE_FINANCEIRO"
  | "CONCLUIDA"
  | "CANCELADA"
```

### 20.3 Status da cobrança local

```ts
type CobrancaStatus =
  | "AGUARDANDO_CRIACAO_ASAAS"
  | "AGUARDANDO_PAGAMENTO"
  | "PAGA"
  | "VENCIDA"
  | "CANCELADA"
  | "ESTORNADA"
  | "FALHA_CRIACAO_ASAAS"
```

### 20.4 Status do acordo financeiro

```ts
type AcordoFinanceiroStatus =
  | "PENDENTE"
  | "ATIVO"
  | "INADIMPLENTE"
  | "CANCELADO"
  | "QUITADO"
```

O pagamento confirmado via webhook pode ativar a matrícula ou rematrícula, dependendo da regra da escola. Algumas escolas podem permitir matrícula ativa antes do pagamento, outras podem exigir pagamento inicial.

---

## 21. Interface do wizard de matrícula e rematrícula

A UI deve ajudar o usuário a entender que o modo familiar cria uma cobrança consolidada.

### 21.1 Etapa de alunos

A tela deve permitir:

- selecionar múltiplos alunos
- escolher turma de cada aluno
- validar mínimo exigido pelo plano
- exibir aviso quando a seleção ainda não cumpre a regra familiar

### 21.2 Etapa de plano

A tela deve mostrar claramente:

```txt
Plano selecionado: Plano Familiar Básico
Modelo de cobrança: Valor único familiar
Alunos incluídos: 3
Valor total: R$ 150,00
```

Ou, em plano por aluno:

```txt
Plano selecionado: Mensalidade Regular
Modelo de cobrança: Por aluno
Alunos incluídos: 3
Valor por aluno: R$ 150,00
Valor total: R$ 450,00
```

### 21.3 Etapa de revisão da matrícula

Antes de finalizar, o usuário deve ver:

```txt
Responsável financeiro: Elaine Costa
Alunos:
- Bryan de Alencar Bezerra / Turma X
- Nicole de Alencar Bezerra / Turma Y
Plano: Plano Familiar Básico
Tipo financeiro: Assinatura mensal
Valor: R$ 150,00
Vencimento inicial: 04/05/2026
Cobranças que serão criadas: 1
```

### 21.4 Etapa de revisão da rematrícula

Antes de finalizar rematrícula, o usuário deve ver:

```txt
Responsável financeiro: Elaine Costa
Período anterior: 2026
Novo período: 2027

Alunos rematriculados:
- Bryan: Turma Infantil A → Turma Infantil B
- Nicole: Turma Juvenil A → Turma Juvenil B

Plano anterior: Plano Familiar 2026
Plano novo: Plano Familiar 2027

Financeiro:
- Taxa de rematrícula: R$ 80,00
- Mensalidade familiar: R$ 150,00/mês
- Cobranças iniciais que serão criadas: 1 ou 2, conforme natureza financeira

Contrato:
Contrato 2027 será gerado
```

Esse resumo reduz confusão operacional e ajuda a identificar bugs antes do submit.

---

## 22. Tela de cobranças

A tela de cobranças não deve listar uma cobrança familiar como se fosse uma cobrança separada por aluno.

### 22.1 Listagem recomendada

```txt
Família Alencar
Plano Familiar Básico
R$ 150,00
Mensalidade
Aguardando pagamento
```

Ou para rematrícula:

```txt
Família Alencar
Rematrícula 2027 - Plano Familiar Básico
R$ 150,00
Mensalidade
Aguardando pagamento
```

### 22.2 Detalhe da cobrança

No detalhe da cobrança, a Alusa pode exibir:

```txt
Responsável financeiro:
Elaine Costa

Alunos vinculados:
- Bryan de Alencar Bezerra
- Nicole de Alencar Bezerra
- Lara Bianca de Alencar

Origem:
Matrícula familiar #123
ou
Rematrícula familiar 2027 #456

Plano:
Plano Familiar Básico

Valor total:
R$ 150,00
```

Assim, a operação financeira continua consolidada, mas a escola mantém visibilidade acadêmica.

---

## 23. Página do responsável no fluxo de rematrícula

A página do responsável deve facilitar a rematrícula familiar.

Antes da rematrícula:

```txt
Elaine Costa

Alunos vinculados:
- Bryan de Alencar Bezerra
  Matrícula atual: 2026 / Turma A
  Próxima rematrícula: pendente

- Nicole de Alencar Bezerra
  Matrícula atual: 2026 / Turma B
  Próxima rematrícula: pendente

Ações:
[Iniciar rematrícula familiar]
```

Depois da rematrícula:

```txt
Rematrícula familiar 2027
Status: Pendente financeiro

Alunos:
- Bryan → Turma Infantil A
- Nicole → Turma Juvenil B

Plano:
Plano Familiar Básico

Financeiro:
1 assinatura mensal de R$ 150,00
Taxa de rematrícula: R$ 80,00, se houver
```

A página do responsável deve ser o lugar natural para a escola responder:

```txt
Quais filhos desse responsável seguem para o próximo período?
Existe inadimplência antes da rematrícula?
Qual plano será usado no novo ciclo?
O contrato anterior será renovado ou encerrado?
Será gerada taxa de rematrícula?
A assinatura será mantida, atualizada ou recriada?
```

---

## 24. Boas práticas de segurança multi-tenant

Todo acesso, criação, atualização e consulta deve filtrar por `contaId`.

Exemplo correto:

```ts
const plano = await tx.plano.findFirstOrThrow({
  where: {
    id: planoId,
    contaId,
    ativo: true,
  },
})
```

Exemplo perigoso:

```ts
const plano = await tx.plano.findUnique({
  where: { id: planoId },
})
```

A segunda abordagem pode permitir vazamento ou uso indevido de dados entre tenants se IDs forem expostos ou manipulados.

Também é importante validar que:

- os alunos pertencem ao mesmo `contaId`
- o responsável pertence ao mesmo `contaId`
- as turmas pertencem ao mesmo `contaId`
- o período letivo pertence ao mesmo `contaId`
- o plano pertence ao mesmo `contaId`
- a subconta Asaas pertence ao mesmo `contaId`
- o contrato pertence ao mesmo `contaId`
- as matrículas anteriores pertencem ao mesmo `contaId`

---

## 25. Auditoria e logs

Eventos financeiros e acadêmicos relevantes devem gerar auditoria.

Exemplos:

```txt
MATRICULA_FAMILIAR_CRIADA
MATRICULA_ALUNO_VINCULADA
REMATRICULA_FAMILIAR_CRIADA
REMATRICULA_ALUNO_VINCULADA
MATRICULA_ANTERIOR_REFERENCIADA
CONTRATO_REMATRICULA_GERADO
COBRANCA_FAMILIAR_CRIADA_LOCALMENTE
EVENTO_ASAAS_ENFILEIRADO
COBRANCA_ASAAS_CRIADA
ASSINATURA_ASAAS_ATUALIZADA
ASSINATURA_ASAAS_CANCELADA
WEBHOOK_ASAAS_RECEBIDO
COBRANCA_PAGA
MATRICULA_ATIVADA_APOS_PAGAMENTO
REMATRICULA_CONCLUIDA
```

Cada evento deve registrar:

- `contaId`
- usuário executor
- entidade afetada
- payload relevante
- data/hora
- origem da ação
- resultado

Logs financeiros devem evitar dados sensíveis desnecessários, especialmente tokens, chaves de API, dados completos de cartão e documentos pessoais.

---

## 26. Webhooks e reconciliação

A integração financeira deve tratar webhooks como fonte principal de mudança de estado financeiro.

### 26.1 Processamento de webhook

O handler de webhook deve:

1. validar assinatura/autenticidade quando aplicável
2. registrar o evento bruto
3. garantir idempotência pelo ID do evento externo
4. localizar a cobrança local por identificador Asaas
5. validar `contaId` pela subconta ou mapeamento interno
6. atualizar status financeiro local
7. disparar efeitos de domínio, se necessário

### 26.2 Idempotência de webhook

Webhooks podem ser enviados mais de uma vez. Por isso, o sistema deve salvar eventos recebidos e impedir processamento duplicado.

Exemplo de constraint:

```prisma
@@unique([contaId, provider, externalEventId])
```

### 26.3 Reconciliação

A reconciliação deve comparar:

- cobranças locais aguardando pagamento
- cobranças existentes no Asaas
- status divergentes
- pagamentos recebidos sem atualização local
- cobranças canceladas externamente
- assinaturas e parcelas futuras
- assinaturas antigas que deveriam ter sido encerradas na rematrícula
- novas assinaturas de rematrícula que não foram criadas corretamente

A reconciliação não substitui os webhooks, mas corrige divergências.

---

## 27. Testes recomendados

### 27.1 Testes unitários com Vitest

Testar regras puras:

```txt
- plano familiar com 2 alunos gera valor único
- plano familiar com 3 alunos gera valor único
- plano por aluno multiplica valor pela quantidade
- matrícula familiar com 1 aluno é inválida quando plano exige família
- rematrícula familiar com 1 aluno é válida quando plano é individual
- rematrícula familiar com 1 aluno falha quando plano exige mínimo de 2
- modelo de cobrança desconhecido falha
- taxa de rematrícula é somada quando configurada
```

Exemplo:

```ts
import { describe, expect, it } from "vitest"

import { calcularValorMatriculaFamiliar } from "./calcularValorMatriculaFamiliar"

describe("calcularValorMatriculaFamiliar", () => {
  it("retorna valor único quando plano é familiar", () => {
    const valor = calcularValorMatriculaFamiliar({
      plano: {
        valor: 150,
        modeloCobranca: "VALOR_UNICO_FAMILIAR",
      },
      quantidadeAlunos: 3,
    })

    expect(valor).toBe(150)
  })

  it("multiplica por aluno quando plano é por aluno", () => {
    const valor = calcularValorMatriculaFamiliar({
      plano: {
        valor: 150,
        modeloCobranca: "POR_ALUNO",
      },
      quantidadeAlunos: 3,
    })

    expect(valor).toBe(450)
  })
})
```

### 27.2 Testes de integração

Testar o caso de uso de matrícula:

```txt
Dado uma conta
E um responsável financeiro
E dois alunos
E um plano familiar
Quando criar matrícula familiar
Então devem existir duas matrículas acadêmicas
E apenas uma cobrança local
E a cobrança deve ter dois itens
E deve existir um evento outbox
```

Testar o caso de uso de rematrícula:

```txt
Dado uma conta
E um responsável financeiro
E dois alunos com matrículas ativas
E um novo período letivo
E um plano familiar
Quando criar rematrícula familiar
Então devem existir duas novas matrículas acadêmicas
E cada nova matrícula deve referenciar a matrícula anterior
E deve existir uma RematriculaFamiliar
E apenas uma cobrança local
E a cobrança deve ter dois itens
E deve existir um evento outbox
```

### 27.3 Testes E2E com Playwright

Cenário principal de matrícula:

```txt
1. Acessar fluxo de matrícula
2. Selecionar modo familiar
3. Adicionar dois alunos
4. Escolher turmas
5. Escolher plano familiar
6. Conferir resumo financeiro
7. Finalizar matrícula
8. Abrir tela de cobranças
9. Confirmar que existe apenas uma cobrança para a família
```

Cenário principal de rematrícula:

```txt
1. Acessar página do responsável
2. Clicar em Iniciar rematrícula familiar
3. Selecionar dois alunos elegíveis
4. Escolher novo período e novas turmas
5. Escolher plano familiar
6. Conferir resumo financeiro
7. Finalizar rematrícula
8. Abrir tela de cobranças
9. Confirmar que existe apenas uma cobrança consolidada
10. Confirmar que as novas matrículas referenciam as anteriores
```

Também testar:

- clique duplo no botão finalizar
- voltar etapa e avançar novamente
- troca de plano familiar para plano por aluno
- rematrícula parcial de apenas um filho
- bloqueio por inadimplência
- falha simulada na criação Asaas
- reprocessamento de outbox
- webhook duplicado

---

## 28. Erros comuns a evitar

### 28.1 Criar cobrança dentro do loop de alunos

Esse é o erro mais provável.

Evitar:

```ts
for (const aluno of alunos) {
  await criarMatricula(aluno)
  await criarCobranca(aluno)
}
```

Usar:

```ts
for (const aluno of alunos) {
  await criarMatricula(aluno)
}

await criarCobrancaUnicaDaFamilia()
```

Para rematrícula:

```ts
for (const aluno of alunos) {
  await criarNovaMatriculaDaRematricula(aluno)
}

await criarCobrancaUnicaDaRematriculaFamiliar()
```

### 28.2 Usar `alunoId` como origem financeira principal

No modo familiar, `alunoId` deve ser item ou referência secundária, não origem da cobrança.

Evitar:

```txt
origemTipo: ALUNO
origemId: alunoId
```

Usar:

```txt
origemTipo: MATRICULA_FAMILIAR
origemId: matriculaFamiliarId
```

Ou:

```txt
origemTipo: REMATRICULA_FAMILIAR
origemId: rematriculaFamiliarId
```

### 28.3 Não diferenciar modelo de cobrança do plano

O plano precisa dizer se é:

- valor único familiar
- por aluno
- combo
- assinatura
- parcelamento
- taxa avulsa
- taxa de rematrícula

Sem isso, a lógica fica implícita e propensa a bugs.

### 28.4 Atualizar status financeiro diretamente pela UI

A UI deve iniciar ações, mas não deve ser a fonte final do status financeiro. O status deve ser confirmado por webhook ou reconciliação.

### 28.5 Não usar idempotência

Sem idempotência, qualquer retry pode gerar cobrança duplicada.

### 28.6 Perder histórico da matrícula anterior

Na rematrícula, a nova matrícula deve manter referência à matrícula anterior. Caso contrário, a escola perde rastreabilidade acadêmica e contratual.

---

## 29. Checklist de implementação

### 29.1 Banco e domínio

- [ ] Criar ou identificar entidade agregadora da matrícula familiar
- [ ] Criar ou identificar entidade agregadora da rematrícula familiar
- [ ] Garantir vínculo entre matrículas individuais e grupo familiar
- [ ] Garantir vínculo entre novas matrículas e matrículas anteriores
- [ ] Criar cobrança com origem no grupo familiar
- [ ] Criar cobrança com origem na rematrícula familiar
- [ ] Criar itens de cobrança para alunos vinculados
- [ ] Adicionar constraints de unicidade para evitar duplicidade
- [ ] Adicionar idempotency key
- [ ] Validar aluno único por período letivo

### 29.2 API e casos de uso

- [ ] Criar DTO com Zod para matrícula familiar
- [ ] Criar DTO com Zod para rematrícula familiar
- [ ] Validar mínimo de alunos conforme plano
- [ ] Validar todos os registros por `contaId`
- [ ] Criar caso de uso transacional de matrícula
- [ ] Criar caso de uso transacional de rematrícula
- [ ] Mover criação financeira para fora do loop de alunos
- [ ] Criar outbox event para integração com Asaas

### 29.3 Financeiro

- [ ] Implementar cálculo por modelo de cobrança do plano
- [ ] Diferenciar cobrança avulsa, assinatura e parcelamento
- [ ] Diferenciar taxa de matrícula e taxa de rematrícula
- [ ] Garantir customer Asaas do responsável financeiro
- [ ] Criar apenas um payment/subscription/installment para o grupo
- [ ] Definir política para assinatura anterior na rematrícula
- [ ] Processar webhooks com idempotência
- [ ] Implementar reconciliação

### 29.4 UI

- [ ] Criar ou evoluir página do responsável
- [ ] Mostrar alunos vinculados ao responsável
- [ ] Adicionar ação Iniciar rematrícula familiar
- [ ] Mostrar quantidade de alunos selecionados
- [ ] Mostrar plano escolhido
- [ ] Mostrar modelo de cobrança
- [ ] Mostrar valor total consolidado
- [ ] Mostrar aviso de que será criada apenas uma cobrança consolidada
- [ ] Mostrar histórico da matrícula anterior na rematrícula
- [ ] Desabilitar submit enquanto processa
- [ ] Proteger contra clique duplo

### 29.5 Testes

- [ ] Unitários para cálculo financeiro
- [ ] Unitários para elegibilidade de rematrícula
- [ ] Integração para caso de uso de matrícula
- [ ] Integração para caso de uso de rematrícula
- [ ] E2E para fluxo completo de matrícula familiar
- [ ] E2E para fluxo completo de rematrícula familiar
- [ ] Teste de clique duplo
- [ ] Teste de retry/outbox
- [ ] Teste de webhook duplicado
- [ ] Teste de inadimplência bloqueando rematrícula

---

## 30. Recomendação final

A matrícula e a rematrícula familiar devem ser tratadas como agregados acadêmico-financeiros próprios dentro da Alusa.

Os alunos devem continuar tendo matrículas acadêmicas individuais, porque cada aluno possui turma, frequência, aulas, histórico, reposições e evolução própria. Porém, o financeiro deve ser consolidado a partir do responsável financeiro, plano escolhido, contrato e grupo familiar.

A regra mais importante é:

```txt
Não criar cobrança por aluno no modo familiar.
Criar cobrança por contrato, acordo financeiro, matrícula familiar ou rematrícula familiar.
```

Para matrícula:

```txt
Responsável financeiro
→ Matrícula familiar
→ Matrículas acadêmicas individuais
→ Contrato/acordo financeiro único
→ Cobrança/assinatura/parcelamento único
→ Webhooks Asaas
→ Estado financeiro local
→ Portal e telas administrativas
```

Para rematrícula:

```txt
Responsável financeiro
→ Rematrícula familiar
→ Novas matrículas acadêmicas individuais
→ Referência às matrículas anteriores
→ Novo contrato/aditivo/acordo financeiro
→ Cobrança/assinatura/parcelamento consolidado
→ Webhooks Asaas
→ Estado financeiro local
→ Portal e telas administrativas
```

A regra de ouro é:

```txt
A matrícula e a rematrícula são individuais no acadêmico,
mas podem ser familiares no financeiro.
```

Essa abordagem melhora:

- consistência financeira
- experiência da escola
- experiência do responsável
- rastreabilidade acadêmica
- histórico contratual
- integração com Asaas
- reconciliação
- prevenção de duplicidade
- manutenção do código
- evolução futura para combos, descontos, rematrícula, inadimplência, contratos e assinaturas

Com isso, a Alusa passa a tratar o fluxo familiar de forma coerente com o domínio educacional e com a arquitetura financeira white label integrada ao Asaas.


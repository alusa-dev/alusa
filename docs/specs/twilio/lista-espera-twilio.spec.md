# Lista de Espera com Notificação Automática (Twilio)

## Visão Geral

Implementação de um fluxo de **lista de espera para turmas** na Alusa, com **notificação automática via Twilio (WhatsApp)** quando uma vaga é liberada.

Objetivo: garantir que pais/alunos sejam avisados rapidamente e possam efetivar a matrícula, mantendo o processo **simples, seguro e eficiente**.

---

## Fluxo Completo

### 1. Pré-cadastro na Lista de Espera

- Pai/mãe (responsável) ou recepcionista acessa os **detalhes da turma**.
- Se a turma estiver cheia, o sistema oferece:
  - Cadastrar o aluno/responsável direto na lista de espera; ou
  - Gerar um **link de lista de espera** para envio (WhatsApp, e-mail, etc.).
- Formulário de lista de espera solicita:
  - **Nome completo do aluno (filho)**  
  - **CPF do responsável**  
  - **Telefone (WhatsApp) do responsável**
- Ao enviar:
  - O sistema cria um **registro de aluno pré-cadastrado** vinculado ao responsável (se ainda não existir).
  - Se o CPF já estiver cadastrado, os dados do responsável são **preenchidos automaticamente**.
- Regras:
  - Permite **múltiplos filhos do mesmo responsável na mesma turma**, desde que o **nome do aluno seja diferente**.
  - **Não permite duplicidade** de **CPF + nome do aluno + turma** na lista de espera.
- Cada entrada de lista de espera representa **um aluno em uma turma específica**.

---

### 2. Persistência

O backend salva uma entrada de lista de espera vinculada:

- À **turma** (turmaId)
- Ao **aluno pré-cadastrado** (studentId)
- Ao **responsável** (responsavelId ou pelo menos CPF)

Status inicial da entrada: **`NA_FILA`**.

---

### 3. Abertura de Vaga

Quando uma vaga é liberada (por cancelamento ou fim de matrícula):

1. O sistema identifica **quantas vagas** ficaram disponíveis naquela turma.
2. Para cada vaga:
   - Busca o **próximo da fila**, em **ordem de chegada**, com status **`NA_FILA`**.
   - Essa busca deve ser feita com **bloqueio/controle de concorrência**, para não “prometer” a mesma vaga para duas pessoas.
     - Ex.: consulta com bloqueio em banco (`FOR UPDATE SKIP LOCKED` ou equivalente com Prisma/PostgreSQL).
3. Para cada entrada selecionada:
   - Gera um **token único de confirmação**.
   - Define um **prazo de resposta** (ex.: `tokenExpiresAt = agora + 24h`).
   - Atualiza o status da entrada para **`NOTIFICADO`**.
   - Chama o serviço Twilio para enviar a mensagem de WhatsApp com o link de confirmação.

---

### 4. Notificação Automática (Twilio)

- Serviço chama o Twilio para enviar mensagem personalizada com:
  - **Nome da escola**
  - **Nome da turma**
  - **Nome do aluno**
  - **Nome do responsável**
  - **Link único de confirmação** (ex.: `/waitlist/confirmar?token=...`)

- Regras do link:
  - **Um link por aluno** (por entrada de lista de espera).
  - O token é:
    - Aleatório e imprevisível.
    - Armazenado no banco apenas como **hash** (`tokenHash`), nunca em texto puro.
    - Associado a um `tokenExpiresAt` (prazo, ex.: 24h).
  - Ao acessar o link:
    - Se token inválido, expirado ou já usado → mostrar mensagem amigável e **não seguir com o fluxo**.

- Prazo de resposta:
  - O responsável/aluno tem um prazo (ex.: **24 horas**) para:
    - **Confirmar interesse** na vaga; ou
    - **Recusar a vaga**.
  - Se **não responder no prazo**, o sistema pode:
    - Em job automático: marcar a entrada como **`REMOVIDO`** ou “expirada” e chamar o próximo da fila.
    - Ou deixar que o gestor trate manualmente (configurável).

- Tratamento de falhas no Twilio:
  - Se o envio da mensagem falhar:
    - **Não mudar** o status para `NOTIFICADO`.
    - Registrar um **log de erro**.
    - Mostrar na tela de gestão que o envio falhou, permitindo **reenvio manual**.

---

### 5. Confirmação de Interesse

Ao clicar no link enviado pelo WhatsApp:

1. O usuário cai em uma **página de confirmação de lista de espera**.
2. A página valida o token:
   - Se tudo ok e dentro do prazo:
     - Mostra os dados da turma e do aluno.
     - Oferece duas ações:
       - **Confirmar interesse**  
       - **Recusar vaga**
3. Regras de status:
   - Ao **confirmar interesse**:
     - Atualiza status da entrada para **`AGUARDANDO_MATRICULA`**.
     - Registra `confirmedAt = agora`.
     - Pode ser definido um **prazo interno de matrícula**, ex.: `enrollmentDeadlineAt = agora + 48h`.
   - Ao **recusar**:
     - Atualiza status para **`REMOVIDO`**.
     - Libera a vaga para o **próximo da fila** (automático ou manual, conforme regra).

---

### 6. Matrícula na Recepção

- Na recepção, a recepcionista acessa o módulo de matrículas.
- Ela consegue localizar os **pré-cadastros com status `AGUARDANDO_MATRICULA`**:
  - Por turma
  - Por CPF
  - Pelo nome do aluno
- Para cada aluno:
  - A recepcionista complementa os dados necessários.
  - Efetiva a matrícula no fluxo normal já existente.

Ao **concluir a matrícula**:

- O sistema:
  - Atualiza o registro do aluno de **“pré-cadastrado” para “matriculado”**.
  - Atualiza a entrada da lista de espera correspondente para status **`EFETIVADO`**.
  - Remove essa entrada da fila daquela turma, para que o aluno **não seja notificado novamente** de novas vagas na mesma turma.

O processo é feito **aluno por aluno**, garantindo controle individual de vagas, mesmo para múltiplos filhos do mesmo responsável.

---

### 7. Gestão e Controle

- Telas para o gestor/recepcionista:
  - **Listar entradas de lista de espera por turma**:
    - Filtro por status (`NA_FILA`, `NOTIFICADO`, `AGUARDANDO_MATRICULA`, `EFETIVADO`, `REMOVIDO`).
    - Busca por CPF, nome do aluno, telefone.
  - **Remover entrada manualmente**:
    - Ex.: desistência após confirmação, erro de cadastro.
    - Ao remover, status vai para `REMOVIDO`.
  - **Reenviar notificação** (opcional):
    - Para entradas `NA_FILA` ou em caso de falha no envio anterior.
  - Visualizar:
    - Data de entrada (`createdAt`)
    - Data de notificação (`notifiedAt`)
    - Data de confirmação (`confirmedAt`)
    - Prazo de matrícula (`enrollmentDeadlineAt`)

- Lógica de expiração (job opcional, ex.: a cada hora):
  - Se status = `NOTIFICADO` e `tokenExpiresAt < agora`:
    - Marcar como `REMOVIDO` (ou “expirado”).
    - Opcional: acionar próximo da fila automaticamente.
  - Se status = `AGUARDANDO_MATRICULA` e `enrollmentDeadlineAt < agora`:
    - Regra a definir:
      - Ou o sistema marca como `REMOVIDO` e libera a vaga.
      - Ou apenas sinaliza para o gestor decidir.

---

## Estrutura de Código

### Backend

**Model principal: `WaitlistEntry`**

Campos sugeridos (nomes ilustrativos):

- `id: string`
- `studentId: string` (referência ao aluno pré-cadastrado)
- `turmaId: string`
- `responsavelId: string | null` (ou uso do CPF diretamente)
- `responsavelCpf: string`
- `responsavelPhone: string`
- `alunoNome: string`

Campos de status e controle:

- `status: "NA_FILA" | "NOTIFICADO" | "AGUARDANDO_MATRICULA" | "EFETIVADO" | "REMOVIDO"`
- `tokenHash: string | null`
- `tokenExpiresAt: Date | null`
- `notifiedAt: Date | null`
- `confirmedAt: Date | null`
- `enrollmentDeadlineAt: Date | null`
- `createdAt: Date`
- `updatedAt: Date`

**APIs / rotas:**

- Criar entrada de lista de espera (pré-cadastro).
- Listar entradas (por turma, status, CPF, etc.).
- Remover/atualizar entradas (gestor).
- Endpoint público para **confirmar ou recusar vaga** via token:
  - `GET /waitlist/confirmar?token=...` – carrega a tela.
  - `POST /waitlist/confirmar` – ação de confirmar.
  - `POST /waitlist/recusar` – ação de recusar.

**Serviços:**

- Serviço de **fila de espera**:
  - Selecionar próximo da fila.
  - Gerar token e atualizar status.
- Serviço de **Twilio**:
  - Enviar mensagem WhatsApp.
  - Tratar erros e logar falhas.
- Job de **expiração de tokens** (opcional, mas recomendado).

**Testes:**

- Unitários:
  - Regras de duplicidade (CPF + aluno + turma).
  - Transição de estados (`NA_FILA` → `NOTIFICADO` → `AGUARDANDO_MATRICULA` → `EFETIVADO`/`REMOVIDO`).
  - Geração/validação de token.
- Integração:
  - Fluxo completo: criar entrada → liberar vaga → notificar → confirmar → efetivar matrícula.
  - Tratamento de expiração.

---

### Frontend

**Formulário de lista de espera:**

- Exibido:
  - Ao tentar matrícula em turma cheia.
  - Ou via **link público** de lista de espera da turma.
- Campos:
  - Nome do aluno (filho)
  - CPF do responsável
  - Telefone (WhatsApp) do responsável
- Regras:
  - Não permitir duplicidade de CPF + nome do aluno na mesma turma.
  - Permitir múltiplos filhos do mesmo responsável em:
    - Diferentes turmas; e
    - Mesma turma, se nomes diferentes.
  - Se CPF já cadastrado:
    - Preencher automaticamente dados do responsável (nome, telefone, etc.).
- Feedback:
  - Estados de carregando, sucesso e erro bem claros.

**Página de confirmação via link:**

- Acessada pelo link único enviado no WhatsApp.
- Exibe:
  - Nome da escola.
  - Nome da turma.
  - Nome do aluno.
  - Prazo (se ainda válido).
- Ações:
  - Botão **“Quero a vaga”** → confirma interesse.
  - Botão **“Não tenho interesse”** → recusa vaga.
- Mensagens:
  - Link expirado.
  - Token inválido.
  - Vaga já preenchida.

**Tela de gestão para admin:**

- Lista de entradas por turma:
  - Tabela com filtros (status, CPF, aluno, datas).
- Ações:
  - Remover entrada.
  - Ver histórico da fila.
  - (Opcional) Reenviar notificação.

**Hooks / integração com API:**

- Hooks React para:
  - Criar entrada de lista de espera.
  - Listar entradas.
  - Confirmar/recusar via token.
  - Ações de gestão (remover, reenviar, etc.).

---

## Exemplo de Código Twilio (ajustado)

```typescript
import { Twilio } from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID!;
const authToken = process.env.TWILIO_AUTH_TOKEN!;
const whatsappFrom = process.env.TWILIO_WHATSAPP_FROM!; // ex: "whatsapp:+14155238886"

const client = new Twilio(accountSid, authToken);

export async function sendWaitlistNotification({
  to,
  nomeResponsavel,
  nomeEscola,
  nomeTurma,
  nomeAluno,
  linkConfirmacao,
}: {
  to: string; // ex: "+55DDDNUMERO"
  nomeResponsavel: string;
  nomeEscola: string;
  nomeTurma: string;
  nomeAluno: string;
  linkConfirmacao: string;
}) {
  const mensagem = [
    `Olá, ${nomeResponsavel}!`,
    `Uma vaga ficou disponível para o(a) aluno(a) ${nomeAluno} na turma ${nomeTurma} da ${nomeEscola}.`,
    `Confirme seu interesse em: ${linkConfirmacao}`,
    `Você tem 24h para responder.`
  ].join(' ');

  try {
    const result = await client.messages.create({
      body: mensagem,
      from: whatsappFrom,
      to: `whatsapp:${to}`,
    });

    return { ok: true, sid: result.sid };
  } catch (error) {
    // Aqui devemos logar o erro de forma estruturada (sem expor segredos)
    console.error('Erro ao enviar mensagem de lista de espera via Twilio', {
      error,
      to,
      nomeTurma,
    });

    return { ok: false, error };
  }
}
````

---

## Boas Práticas

* Solicitar apenas dados essenciais:

  * Nome do aluno (filho)
  * CPF do responsável
  * Telefone (WhatsApp)
* Mensagem personalizada com:

  * Nome da escola
  * Nome da turma
  * Nome do aluno
* **Não permitir duplicidade** de CPF + nome do aluno na mesma turma.
* Permitir **múltiplos filhos do mesmo responsável** em:

  * Diferentes turmas; e
  * Mesma turma, se nomes diferentes.
* Preenchimento automático dos dados do responsável se CPF já cadastrado.
* Link único, com token **seguro e com expiração**.
* Controle de prazos:

  * Resposta à notificação (ex.: 24h).
  * Efetivação da matrícula após confirmação (ex.: 48h).
* Status claros:

  * `NA_FILA`
  * `NOTIFICADO`
  * `AGUARDANDO_MATRICULA`
  * `EFETIVADO`
  * `REMOVIDO`
* Feedback visual claro em todas as telas.
* Tratamento de erro do Twilio com logs estruturados.
* Testes cobrindo:

  * Todos os fluxos de negócio.
  * Regras de duplicidade.
  * Expiração de tokens.
* Seguir **Clean Code** e **Clean Architecture** na organização de serviços e camadas.

---

## Pontos Detalhados (Cenários Importantes)

* **Confirmação de interesse sem matrícula efetivada:**

  * Após o responsável confirmar interesse pelo link:

    * Status muda para `AGUARDANDO_MATRICULA`.
    * O gestor pode definir um prazo (ex.: 48h) para efetivar a matrícula.
  * Se a matrícula não for concluída nesse prazo:

    * O gestor pode remover manualmente; ou
    * Um job automático pode marcar como `REMOVIDO` e liberar a vaga para o próximo.

* **Remoção automática após matrícula:**

  * Ao efetivar a matrícula (CPF + nome do aluno + turma):

    * O sistema encontra a entrada da lista de espera correspondente.
    * Atualiza o status para `EFETIVADO`.
    * Remove essa entrada da fila (não recebe novas notificações para a mesma turma).

* **Pai já cadastrado com um filho em uma turma, deseja colocar outro filho na mesma turma (cheia):**

  * Preenche o formulário com o nome do novo filho, mesmo CPF e telefone.
  * O sistema permite, pois o **nome do aluno é diferente**.
  * Cada pré-cadastro gera um **registro de aluno distinto**, ambos vinculados ao mesmo responsável.
  * Cada aluno terá sua própria entrada na lista de espera, com seu próprio link.

* **Pai tenta cadastrar o mesmo filho duas vezes na mesma turma:**

  * O sistema bloqueia, pois já existe entrada com o mesmo **CPF + nome do aluno + turma**.

* **Pai com filhos em turmas diferentes:**

  * Pode cadastrar cada filho em listas de espera de turmas diferentes normalmente.
  * Cada pré-cadastro gera um **registro de aluno distinto**, ambos vinculados ao mesmo responsável.

---

## Possíveis Evoluções Futuras

* Notificação por e-mail (além do WhatsApp).
* Dashboard de acompanhamento da lista de espera.
* Exportação da lista (CSV/Excel).
* Logs de auditoria detalhados (quem moveu qual entrada, quando).
* Regras de prioridade (ex.: irmãos já matriculados, antiguidade, etc.).
* Suporte a múltiplos responsáveis por aluno (pai, mãe, tutor).
* Integração com outros canais (SMS, app próprio).

---

**Alusa — Lista de Espera Inteligente**

```

---

### Como validar (deste documento)

- Ler o documento pensando em cada cenário real do dia a dia da escola.
- Verificar se:
  - Todos os estados cobrem os casos que você imagina.
  - As regras de CPF + aluno + turma batem com a prática.
  - O fluxo de comunicação (24h + 48h) faz sentido para a operação da recepção.

---

Suposição  
Assumi que o sistema da Alusa já possui módulo de **turmas/matrículas com controle de vagas**, e que será possível rodar jobs (cron) para tratar expirações de token e de matrícula, se vocês optarem por automatizar essa parte.
```

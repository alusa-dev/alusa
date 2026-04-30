# Análise do Fluxo de Matrícula e Rematrícula

## 📑 Dados obrigatórios para geração de contrato

Para garantir que todo contrato gerado pelo sistema Alusa seja juridicamente válido e completo, é necessário que os seguintes dados estejam devidamente cadastrados e validados:

### Dados da Escola (Instituição)
- Razão social
- Nome fantasia (se aplicável)
- CNPJ (ou CPF, para MEI)
- Endereço completo:
  - Rua/Logradouro
  - Número
  - Complemento (opcional)
  - Bairro
  - Cidade
  - Estado (UF)
  - CEP
- Telefone institucional
- E-mail institucional
- Representante legal:
  - Nome completo
  - CPF
  - Cargo/função
- Inscrição Estadual/Municipal (se aplicável)
- Site institucional (opcional)

### Dados do Responsável (quando aplicável)
- Nome completo
- CPF
- E-mail
- Telefone
- Endereço completo (se diferente do aluno)

### Dados do Aluno
- Nome completo
- CPF (se maior de idade ou exigido)
- Data de nascimento
- E-mail (opcional)
- Telefone (opcional)
- Endereço completo (se necessário)

### Pontos de atenção
- Todos os campos obrigatórios devem ser validados antes de permitir a geração/assinatura do contrato.
- O sistema deve alertar o usuário caso algum dado essencial esteja faltando no cadastro.
- Os dados devem ser integrados automaticamente ao template do contrato, preenchendo todos os placeholders (@escola, @cnpj, @responsavel, etc).

Assim, o fluxo de matrícula, rematrícula e assinatura de contrato estará sempre juridicamente seguro e completo.

## 📋 Resumo Executivo

Esta análise examina a coerência do fluxo de matrícula e rematrícula em um sistema baseado em contratos com data de término.

---

## 🔄 Fluxo Atual

### 1. Criação de Matrícula (`criarMatricula`)

**Estado Inicial:**
- `status`: `ATIVA` (default)
- `statusContrato`: `ATIVO` (default no schema)
- `dataInicio`: definida pelo usuário
- `dataFimContrato`: definida pelo usuário
- `dataFim`: `null`

**O que acontece:**
1. Validações de negócio (idade, capacidade, conflitos)
2. Criação da matrícula com `statusContrato = ATIVO`
3. Criação de cobranças (taxa e mensalidade)
4. Integração com Asaas (se habilitado)

**Observação crítica:** Não há lógica que atualiza automaticamente `statusContrato` quando `dataFimContrato` passa.

---

### 2. Rematrícula (`criarRematricula`)

**Elegibilidade:**
```typescript
where: {
  status: { in: [ATIVA, PAUSADA] },
  OR: [
    { statusContrato: ENCERRADO },
    { dataFimContrato: { lte: ate } } // ate = hoje + diasAntecedencia
  ]
}
```

**Validações:**
1. Matrícula anterior deve existir
2. Nova `dataInicio` >= `dataFimContrato` da anterior
3. Se contrato ainda ativo: `dataFimContrato > hoje` E `dataFimContrato > novaDataInicio` → ERRO

**O que acontece:**
1. Cria nova matrícula (herda configurações)
2. **Atualiza matrícula anterior:**
   - `statusContrato = ENCERRADO`
   - `dataFim = dataFimContrato` (ou mantém se já existir)
3. Cria log: `REMATRICULA_GERADA`

---

## ⚠️ Problemas Identificados

### 1. **StatusContrato não é atualizado automaticamente**

**Problema:**
- Quando `dataFimContrato` passa, o `statusContrato` permanece `ATIVO`
- A rematrícula depende de `statusContrato = ENCERRADO` OU `dataFimContrato <= hoje + antecedência`
- Isso cria uma inconsistência: contrato expirado mas status ainda `ATIVO`

**Impacto:**
- Matrículas podem aparecer como elegíveis para rematrícula mesmo com contrato expirado
- Mas a lógica de `podeRenovar` pode bloquear incorretamente

### 2. **Lógica redundante de `podeRenovar`**

```typescript
const contratoExpirado = diasRestantes < 0 || matricula.statusContrato === StatusContrato.ENCERRADO;
const podeRenovar = contratoExpirado || matricula.statusContrato === StatusContrato.ENCERRADO;
```

**Problema:** A segunda condição é redundante. Se `contratoExpirado` já inclui `statusContrato === ENCERRADO`, então `podeRenovar` sempre será `true` quando `contratoExpirado` for `true`.

**Correção sugerida:**
```typescript
const podeRenovar = contratoExpirado;
// ou
const podeRenovar = diasRestantes < 0 || matricula.statusContrato === StatusContrato.ENCERRADO;
```

### 3. **Validação de data de início na rematrícula**

**Código atual:**
```typescript
if (novaDataInicio < matriculaAtual.dataFimContrato) {
  throw new Error('A nova matrícula deve iniciar após o fim do contrato atual.');
}

if (
  matriculaAtual.statusContrato === StatusContrato.ATIVO &&
  matriculaAtual.dataFimContrato > new Date() &&
  matriculaAtual.dataFimContrato > novaDataInicio
) {
  throw new Error('Contrato atual ainda vigente. Ajuste a data de início da rematrícula.');
}
```

**Problema:** A segunda validação é redundante. Se `novaDataInicio >= dataFimContrato`, então `dataFimContrato > novaDataInicio` nunca será verdadeiro.

### 4. **Falta de processo automático de encerramento**

**Problema:** Não há job/cron que:
- Atualize `statusContrato` de `ATIVO` para `ENCERRADO` quando `dataFimContrato` passa
- Isso pode causar inconsistências no banco

---

## ✅ Pontos Positivos

1. **Herança de configurações:** A rematrícula herda corretamente forma de pagamento, descontos, etc.
2. **Validação de datas:** Impede sobreposição de contratos
3. **Logs de auditoria:** Registra a rematrícula no histórico
4. **Transações:** Uso correto de transações para garantir consistência

---

## 🔧 Recomendações

### 1. **Criar processo automático de encerramento**

Sugestão: Job diário que atualiza `statusContrato`:

```typescript
// Exemplo de lógica
await prisma.matricula.updateMany({
  where: {
    statusContrato: StatusContrato.ATIVO,
    dataFimContrato: { lte: new Date() }
  },
  data: {
    statusContrato: StatusContrato.ENCERRADO
  }
});
```

### 2. **Simplificar lógica de `podeRenovar`**

```typescript
const podeRenovar = diasRestantes < 0 || matricula.statusContrato === StatusContrato.ENCERRADO;
```

### 3. **Simplificar validação na rematrícula**

A segunda validação pode ser removida, pois é redundante.

### 4. **Adicionar validação no frontend**

Validar no dialog que `dataInicio >= dataFimContrato` antes de permitir submit.

### 5. **Considerar atualizar `dataFim` automaticamente**

Quando `statusContrato` muda para `ENCERRADO`, atualizar `dataFim` se ainda for `null`:

```typescript
dataFim: matriculaAtual.dataFim ?? matriculaAtual.dataFimContrato
```

### 6. **Compartilhamento e acesso ao contrato gerado**


Após a geração do contrato (a partir do template escolhido no wizard), disponibilizar ações para visualizar, baixar e principalmente **enviar o link para assinatura digital** do contrato pelo responsável ou aluno.

**Recomendações para o fluxo de assinatura:**
- O botão/ação deve ser explícito, por exemplo: "Enviar link para assinatura" ou "Compartilhar para assinatura".
- Ao clicar, o sistema gera (ou revela) a página pública de assinatura do contrato, exclusiva para aquele responsável/aluno.
- O link compartilhado não tem expiração: permanece válido até a assinatura ser realizada.
- Só é permitida uma assinatura por contrato. Após assinado, o contrato fica bloqueado para novas assinaturas.
- O status do contrato é exibido apenas via badges internos no sistema (sem notificações automáticas).
- O envio pode ser feito por cópia do link, e-mail, WhatsApp ou outros canais integrados.
- Acompanhamento do fluxo é feito apenas por status/badges internos.
- A página de assinatura deve ser acessível (leitores de tela, navegação por teclado, etc).

**Pontos de acesso recomendados:**
  - Menu de ações da matrícula (três pontinhos): opção "Enviar para assinatura".
  - Página de detalhes da matrícula: seção dedicada ao contrato, com botão para "Enviar para assinatura".
  - Gestão de Contratos: cada contrato listado deve permitir "Enviar para assinatura".

Assim, o usuário encontra o contrato facilmente em todos os pontos naturais do fluxo, garantindo praticidade, rastreabilidade e boa experiência para o cliente e para a instituição.


### 7. **Fluxo da página de assinatura digital do contrato (responsável/aluno)**

Ao acessar o link de assinatura, o responsável/aluno verá:

- Um box com título, por exemplo: "Assinatura do Contrato de Matrícula".
- Um botão "Ler contrato" que abre o PDF do contrato em outra aba para leitura completa.
- Exibição dos dados pessoais essenciais (nome, CPF, e-mail, telefone, etc) já preenchidos. Se algum dado estiver faltando, exibir o(s) input(s) correspondente(s) para preenchimento/correção.
- Checkbox de aceite: "Li e concordo com todos os termos do contrato." (obrigatório para habilitar a assinatura).
- Botão "Assinar contrato" (só habilitado após o checkbox ser marcado e todos os dados obrigatórios preenchidos).
- (Opcional) Aviso legal reforçando a validade da assinatura digital.
- Após a assinatura, exibir mensagem de sucesso e os dados da assinatura (nome, data/hora, IP, e-mail).

**Pontos de atenção:**
- Garantir que os dados usados no contrato estejam validados no momento da assinatura.
- Registrar data/hora, IP, navegador/dispositivo, e-mail e nome do assinante para validade jurídica e auditoria.
- Não permitir assinatura se houver campos obrigatórios faltando.
- Se o responsável/aluno corrigir dados pessoais na assinatura, apenas os dados são atualizados; o contrato não é re-gerado.



### 8. **Visualização do contrato por contas internas (escola, professor, gestor, etc)**

- Usuários internos sempre podem visualizar o contrato, independente do status.
- O status do contrato deve ser exibido de forma clara no topo do documento (ex: "Assinado", "Pendente", "Recusado", "Cancelado").
- Se o contrato estiver assinado, exibir os dados completos da assinatura: nome, data/hora, IP, e-mail do responsável/aluno.
- Se não estiver assinado, mostrar o campo como "(vazio)" ou "Aguardando assinatura".
- Permitir download/visualização do PDF do contrato em qualquer status.
- Exibir quem é o responsável pela assinatura (nome, e-mail).
- Se o contrato for recusado ou expirado, mostrar status e motivo.
- (Opcional, recomendado) Exibir histórico/auditoria: logs de envio, visualização, assinatura, etc.

**Pontos de atenção:**
- Garantir que o status e os dados de assinatura estejam sempre atualizados e sincronizados com o backend.
- Não permitir edição do contrato após assinatura, apenas visualização.
- Garantir rastreabilidade e transparência para a escola e para o responsável/aluno.

---

## 📊 Diagrama de Fluxo

```
[Matrícula Criada]
  statusContrato = ATIVO
  dataFimContrato = X
  
  ↓ (tempo passa)
  
[dataFimContrato < hoje]
  ❌ statusContrato ainda ATIVO (inconsistência)
  
  ↓ (rematrícula)
  
[Busca Elegíveis]
  WHERE statusContrato = ENCERRADO 
     OR dataFimContrato <= hoje + antecedência
  
  ↓ (cria rematrícula)
  
[Nova Matrícula]
  statusContrato = ATIVO
  dataFimContrato = Y
  
[Matrícula Anterior]
  statusContrato = ENCERRADO ✅
  dataFim = dataFimContrato ✅
```

---

## 🎯 Conclusão

**O fluxo está funcionalmente coerente**, mas há **inconsistências de estado** que podem causar problemas:

1. ✅ A rematrícula funciona corretamente quando o contrato está encerrado
2. ⚠️ Mas depende de `dataFimContrato` para encontrar elegíveis, não apenas `statusContrato`
3. ⚠️ Falta processo automático para manter `statusContrato` sincronizado com `dataFimContrato`
4. ⚠️ Lógica redundante que pode ser simplificada

**Recomendação principal:** Implementar processo automático de encerramento de contratos para manter consistência.


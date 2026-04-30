# Fluxo de Cadastro de Turmas

---

## 1. Passo a Passo do Fluxo

### 1.1. Acesso à Página
- O usuário acessa a página de cadastro de turmas através do menu lateral (sidebar).
- A página exibe um formulário com campos obrigatórios e opcionais.

### 1.2. Preenchimento do Formulário
- **Campos Obrigatórios**:
  - Nome da turma.
  - Modalidade.
  - Professor responsável.
  - Capacidade máxima.
- **Campos Opcionais**:
  - Horário das aulas.
  - Observações adicionais.

### 1.3. Validações
- Campos obrigatórios não preenchidos exibem mensagens de erro em vermelho.
- Capacidade máxima deve ser um número positivo.

### 1.4. Submissão
- O botão "Salvar" fica habilitado apenas após o preenchimento correto de todos os campos obrigatórios.
- Ao clicar em "Salvar":
  - O sistema exibe um estado de carregamento (spinner).
  - Envia os dados para a API de cadastro.

### 1.5. Feedback
- **Sucesso**:
  - Mensagem verde: "Turma cadastrada com sucesso!"
  - Redirecionamento opcional para a lista de turmas.
- **Erro**:
  - Mensagem vermelha com detalhes do problema (ex.: "Nome da turma já cadastrado").

---

## 2. Regras de Negócio

### 2.1. Campos Obrigatórios
- Nome da turma, modalidade, professor responsável e capacidade máxima.

### 2.2. Restrições
- Capacidade máxima deve ser um número positivo.

---

## 3. Exemplo de Entrada e Saída

### 3.1. Exemplo de Dados Enviados
```json
{
  "nome": "Turma A",
  "modalidade": "Yoga",
  "professor": "João da Silva",
  "capacidadeMaxima": 20,
  "horario": "Segunda e Quarta, 18h às 19h",
  "observacoes": "Turma para iniciantes."
}
```

### 3.2. Exemplo de Resposta de Sucesso
```json
{
  "mensagem": "Turma cadastrada com sucesso!",
  "id": "turma_a"
}
```

### 3.3. Exemplo de Resposta de Erro
```json
{
  "erro": "Nome da turma já cadastrado."
}
```

---

## 4. Feedback Visual

### 4.1. Mensagens de Erro
- Exibidas abaixo do campo correspondente.
- Ícones de alerta ao lado do campo.

### 4.2. Mensagens de Sucesso
- Fundo verde claro com ícone de check.
- Texto: "Turma cadastrada com sucesso!"

### 4.3. Estados de Carregamento
- Spinner exibido no botão "Salvar" durante a submissão.

---
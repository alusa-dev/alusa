# Fluxo de Cadastro de Alunos

---

## 1. Passo a Passo do Fluxo

### 1.1. Acesso à Página
- O usuário acessa a página de cadastro de alunos através do menu lateral (sidebar).
- A página exibe um formulário com campos obrigatórios e opcionais.

### 1.2. Preenchimento do Formulário
- **Campos Obrigatórios**:
  - Nome completo.
  - Data de nascimento.
  - CPF (validação de formato e duplicidade).
  - Contato (e-mail ou telefone).
- **Campos Opcionais**:
  - Endereço.
  - Nome do responsável (para menores de idade).

### 1.3. Validações
- Campos obrigatórios não preenchidos exibem mensagens de erro em vermelho.
- CPF inválido ou já cadastrado impede a submissão.
- Data de nascimento deve indicar idade mínima de 5 anos.

### 1.4. Submissão
- O botão "Salvar" fica habilitado apenas após o preenchimento correto de todos os campos obrigatórios.
- Ao clicar em "Salvar":
  - O sistema exibe um estado de carregamento (spinner).
  - Envia os dados para a API de cadastro.

### 1.5. Feedback
- **Sucesso**:
  - Mensagem verde: "Aluno cadastrado com sucesso!"
  - Redirecionamento opcional para a lista de alunos.
- **Erro**:
  - Mensagem vermelha com detalhes do problema (ex.: "CPF já cadastrado").

---

## 2. Regras de Negócio

### 2.1. Campos Obrigatórios
- Nome, data de nascimento, CPF e contato.

### 2.2. Restrições
- CPF deve ser único no sistema.
- Idade mínima: 5 anos.

### 2.3. Validações
- Formato do CPF (###.###.###-##).
- E-mail válido (ex.: nome@dominio.com).

---

## 3. Exemplo de Entrada e Saída

### 3.1. Exemplo de Dados Enviados
```json
{
  "nome": "João da Silva",
  "dataNascimento": "2010-05-15",
  "cpf": "123.456.789-00",
  "contato": {
    "email": "joao.silva@email.com",
    "telefone": "(11) 91234-5678"
  },
  "endereco": {
    "rua": "Rua das Flores",
    "numero": 123,
    "cidade": "São Paulo",
    "estado": "SP"
  }
}
```

### 3.2. Exemplo de Resposta de Sucesso
```json
{
  "mensagem": "Aluno cadastrado com sucesso!",
  "id": "aluno_123456"
}
```

### 3.3. Exemplo de Resposta de Erro
```json
{
  "erro": "CPF já cadastrado."
}
```

---

## 4. Feedback Visual

### 4.1. Mensagens de Erro
- Exibidas abaixo do campo correspondente.
- Ícones de alerta ao lado do campo.

### 4.2. Mensagens de Sucesso
- Fundo verde claro com ícone de check.
- Texto: "Aluno cadastrado com sucesso!"

### 4.3. Estados de Carregamento
- Spinner exibido no botão "Salvar" durante a submissão.

---
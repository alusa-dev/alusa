# Fluxo de Cadastro de Planos

---

## 1. Passo a Passo do Fluxo

### 1.1. Acesso à Página
- O usuário acessa a página de cadastro de planos através do menu lateral (sidebar).
- A página exibe um formulário com campos obrigatórios e opcionais.

### 1.2. Preenchimento do Formulário
- **Campos Obrigatórios**:
  - Nome do plano.
  - Descrição.
  - Preço mensal.
- **Campos Opcionais**:
  - Benefícios inclusos.
  - Duração do plano.

### 1.3. Validações
- Campos obrigatórios não preenchidos exibem mensagens de erro em vermelho.
- Preço mensal deve ser um número positivo.

### 1.4. Submissão
- O botão "Salvar" fica habilitado apenas após o preenchimento correto de todos os campos obrigatórios.
- Ao clicar em "Salvar":
  - O sistema exibe um estado de carregamento (spinner).
  - Envia os dados para a API de cadastro.

### 1.5. Feedback
- **Sucesso**:
  - Mensagem verde: "Plano cadastrado com sucesso!"
  - Redirecionamento opcional para a lista de planos.
- **Erro**:
  - Mensagem vermelha com detalhes do problema (ex.: "Nome do plano já cadastrado").

---

## 2. Regras de Negócio

### 2.1. Campos Obrigatórios
- Nome do plano, descrição e preço mensal.

### 2.2. Restrições
- Preço mensal deve ser um número positivo.

---

## 3. Exemplo de Entrada e Saída

### 3.1. Exemplo de Dados Enviados
```json
{
  "nome": "Plano Premium",
  "descricao": "Acesso ilimitado a todas as modalidades.",
  "precoMensal": 200.0,
  "beneficios": ["Aulas ilimitadas", "Acesso VIP"],
  "duracao": "12 meses"
}
```

### 3.2. Exemplo de Resposta de Sucesso
```json
{
  "mensagem": "Plano cadastrado com sucesso!",
  "id": "plano_premium"
}
```

### 3.3. Exemplo de Resposta de Erro
```json
{
  "erro": "Nome do plano já cadastrado."
}
```

---

## 4. Feedback Visual

### 4.1. Mensagens de Erro
- Exibidas abaixo do campo correspondente.
- Ícones de alerta ao lado do campo.

### 4.2. Mensagens de Sucesso
- Fundo verde claro com ícone de check.
- Texto: "Plano cadastrado com sucesso!"

### 4.3. Estados de Carregamento
- Spinner exibido no botão "Salvar" durante a submissão.

---
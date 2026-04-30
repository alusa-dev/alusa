# Fluxo de Cadastro de Combos

---

## 1. Passo a Passo do Fluxo

### 1.1. Acesso à Página
- O usuário acessa a página de cadastro de combos através do menu lateral (sidebar).
- A página exibe um formulário com campos obrigatórios e opcionais.

### 1.2. Preenchimento do Formulário
- **Campos Obrigatórios**:
  - Nome do combo.
  - Descrição.
  - Preço.
- **Campos Opcionais**:
  - Itens inclusos no combo.
  - Duração do combo.

### 1.3. Validações
- Campos obrigatórios não preenchidos exibem mensagens de erro em vermelho.
- Preço deve ser um número positivo.

### 1.4. Submissão
- O botão "Salvar" fica habilitado apenas após o preenchimento correto de todos os campos obrigatórios.
- Ao clicar em "Salvar":
  - O sistema exibe um estado de carregamento (spinner).
  - Envia os dados para a API de cadastro.

### 1.5. Feedback
- **Sucesso**:
  - Mensagem verde: "Combo cadastrado com sucesso!"
  - Redirecionamento opcional para a lista de combos.
- **Erro**:
  - Mensagem vermelha com detalhes do problema (ex.: "Nome do combo já cadastrado").

---

## 2. Regras de Negócio

### 2.1. Campos Obrigatórios
- Nome do combo, descrição e preço.

### 2.2. Restrições
- Preço deve ser um número positivo.

---

## 3. Exemplo de Entrada e Saída

### 3.1. Exemplo de Dados Enviados
```json
{
  "nome": "Combo Fitness",
  "descricao": "Inclui aulas de yoga, pilates e musculação.",
  "preco": 150.0,
  "itens": ["Yoga", "Pilates", "Musculação"],
  "duracao": "3 meses"
}
```

### 3.2. Exemplo de Resposta de Sucesso
```json
{
  "mensagem": "Combo cadastrado com sucesso!",
  "id": "combo_fitness"
}
```

### 3.3. Exemplo de Resposta de Erro
```json
{
  "erro": "Nome do combo já cadastrado."
}
```

---

## 4. Feedback Visual

### 4.1. Mensagens de Erro
- Exibidas abaixo do campo correspondente.
- Ícones de alerta ao lado do campo.

### 4.2. Mensagens de Sucesso
- Fundo verde claro com ícone de check.
- Texto: "Combo cadastrado com sucesso!"

### 4.3. Estados de Carregamento
- Spinner exibido no botão "Salvar" durante a submissão.

---
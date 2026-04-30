# Documentação — Estilo do Sistema Alusa

---

## 1. Visão Geral
O estilo do sistema Alusa foi projetado para oferecer uma experiência moderna, intuitiva e acessível. Este documento descreve os padrões visuais, interativos e de usabilidade adotados no sistema, garantindo consistência e alinhamento com as melhores práticas de design.

---

## 2. Identidade Visual

### 2.1. Paleta de Cores
A paleta de cores do sistema reflete profissionalismo e acessibilidade, com tons suaves e contrastes adequados para leitura.

- **Primária**: Azul (#007BFF) — Representa confiança e tecnologia.
- **Secundária**: Verde (#28A745) — Indica sucesso e ações positivas.
- **Erro**: Vermelho (#DC3545) — Utilizado para mensagens de erro.
- **Neutras**:
  - Cinza Claro (#F8F9FA) — Fundo de páginas.
  - Cinza Médio (#6C757D) — Textos secundários.
  - Preto (#343A40) — Textos principais.

### 2.2. Tipografia
- **Fonte Principal**: `Roboto`, sans-serif.
- **Tamanhos**:
  - Títulos: 24px, 20px.
  - Textos: 16px (padrão), 14px (secundário).
- **Estilo**:
  - Negrito para ênfase.
  - Itálico para destaques sutis.

### 2.3. Ícones
- **Biblioteca**: Utilização de ícones do Material Design.
- **Tamanho**: 24px para ícones principais, 16px para ícones auxiliares.
- **Estilo**: Simples, com preenchimento sólido.

---

## 3. Componentes de Interface

### 3.1. Botões
- **Estilo**:
  - Botões primários: Fundo azul com texto branco.
  - Botões secundários: Fundo branco com borda azul e texto azul.
- **Estados**:
  - Hover: Alteração de cor para indicar interatividade.
  - Desabilitado: Opacidade reduzida.

### 3.2. Formulários
- **Campos de Entrada**:
  - Bordas arredondadas.
  - Placeholder em cinza médio.
- **Validações**:
  - Mensagens de erro em vermelho abaixo do campo.
  - Ícones de sucesso ou erro ao lado do campo.

### 3.3. Tabelas
- **Estilo**:
  - Linhas alternadas com fundo cinza claro.
  - Cabeçalhos em negrito.
- **Interatividade**:
  - Linhas destacadas ao passar o mouse.

### 3.4. Modais
- **Estilo**:
  - Fundo branco com bordas suaves.
  - Sombra leve para destacar.
- **Fechamento**:
  - Ícone de "X" no canto superior direito.
  - Clique fora do modal para fechar.

---

## 4. Usabilidade

### 4.1. Design Responsivo
- **Mobile-first**: O sistema é projetado para funcionar perfeitamente em dispositivos móveis, tablets e desktops.
- **Breakpoints**:
  - `sm`: 640px.
  - `md`: 768px.
  - `lg`: 1024px.
  - `xl`: 1280px.

### 4.2. Acessibilidade
- **Padrões**: Segue as diretrizes WCAG 2.1.
- **Recursos**:
  - Suporte a navegação por teclado.
  - Textos alternativos para imagens.
  - Contraste adequado entre texto e fundo.

---

## 5. Feedback Visual

### 5.1. Estados de Carregamento
- **Skeletons**: Utilizados para tabelas e listas.
- **Spinners**: Para ações como envio de formulários.

### 5.2. Mensagens de Erro e Sucesso
- **Erro**:
  - Fundo vermelho claro com ícone de alerta.
  - Texto descritivo do problema.
- **Sucesso**:
  - Fundo verde claro com ícone de check.
  - Texto confirmando a ação.

---

## 6. Exemplos de Uso

### 6.1. Página de Cadastro de Alunos
- **Componentes**:
  - Formulário com validação em tempo real.
  - Botão de "Salvar" com estado de carregamento.
- **Estilo**:
  - Fundo branco com título em azul.
  - Mensagens de erro em vermelho abaixo dos campos.

### 6.2. Dashboard
- **Componentes**:
  - Gráficos interativos.
  - Tabelas com filtros e paginação.
- **Estilo**:
  - Fundo cinza claro.
  - Cards com bordas suaves e sombras leves.

---

## 7. Observações Finais
O estilo do sistema Alusa é projetado para ser consistente, acessível e moderno. Qualquer alteração ou adição ao estilo deve seguir os padrões descritos neste documento para garantir a uniformidade da experiência do usuário.

---

## 8. Referências
- [Material Design](https://material.io/design)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)

---

## 9. Estilo e Arquitetura do Sistema

### 9.1. Arquitetura SPA
O sistema Alusa é desenvolvido como uma **Single Page Application (SPA)**, utilizando o framework **Next.js**. Isso significa que a navegação entre páginas é fluida, sem recarregamento completo, proporcionando uma experiência mais rápida e interativa para o usuário.

- **Vantagens da SPA**:
  - Redução no tempo de carregamento após o primeiro acesso.
  - Melhor experiência do usuário com transições suaves.
  - Possibilidade de cache local para melhorar a performance.
- **Desafios**:
  - Gerenciamento de estado mais complexo (resolvido com ferramentas como Context API ou Zustand).
  - SEO aprimorado com renderização híbrida do Next.js (SSR e SSG).

### 9.2. Sidebar e Navegação
A sidebar é um elemento central no sistema, garantindo acesso rápido às principais funcionalidades.

- **Estilo**:
  - Fundo: Azul escuro (#343A40) para contraste com o conteúdo principal.
  - Ícones: Brancos, com preenchimento sólido, utilizando Material Design.
  - Texto: Branco, com fonte Roboto e tamanho de 16px.
- **Interatividade**:
  - Itens destacados ao passar o mouse (hover) com fundo azul claro (#007BFF).
  - Ícone ativo com indicador visual (barra lateral ou sublinhado).
- **Responsividade**:
  - Em dispositivos móveis, a sidebar é colapsada em um menu hambúrguer.
  - Transições suaves ao abrir e fechar.
- **Estrutura**:
  - **Seções principais**: Divididas por categorias, como "Dashboard", "Matrículas", "Relatórios".
  - **Submenus**: Itens aninhados para funcionalidades específicas.

### 9.3. Responsabilidades do Frontend
O frontend do sistema é responsável por:

- **Renderização de Componentes**:
  - Utilização de componentes reutilizáveis para garantir consistência visual.
  - Exemplos: Botões, tabelas, modais, formulários.
- **Gerenciamento de Estado**:
  - Context API para estados globais (ex.: autenticação, tema).
  - Zustand para estados locais e específicos de componentes.
- **Comunicação com a API**:
  - Fetch API ou Axios para chamadas REST.
  - Tratamento de erros e exibição de mensagens ao usuário.
- **Acessibilidade**:
  - Garantir que todos os elementos interativos sejam navegáveis por teclado.
  - Uso de atributos ARIA para melhorar a experiência de usuários com deficiência.

### 9.4. Estilo de Componentes Avançados

#### 9.4.1. Gráficos e Dashboards
- **Biblioteca**: Utilização do Chart.js para gráficos interativos.
- **Estilo**:
  - Cores consistentes com a paleta do sistema.
  - Legendas claras e interativas.
- **Tipos de Gráficos**:
  - Barras, linhas, pizza, e gráficos combinados.

#### 9.4.2. Tabelas Avançadas
- **Recursos**:
  - Filtros dinâmicos.
  - Paginação com carregamento assíncrono.
  - Exportação para Excel e PDF.
- **Estilo**:
  - Cabeçalhos fixos para facilitar a navegação em tabelas longas.
  - Ícones de ordenação ao lado dos cabeçalhos.

---

## 10. Observações Finais
O sistema Alusa combina uma arquitetura moderna com um design consistente e acessível. A sidebar, como elemento central, reflete a organização e a fluidez da navegação. A adoção de uma SPA garante uma experiência otimizada, enquanto os componentes avançados, como gráficos e tabelas, oferecem funcionalidades robustas para os usuários. Qualquer evolução no estilo ou arquitetura deve seguir os padrões descritos neste documento.

---
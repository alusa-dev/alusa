type SearchPresetItem = {
  id: string;
  title: string;
  description: string;
  href: string;
  keywords: string[];
  roles?: string[];
};

export const GLOBAL_SEARCH_MIN_QUERY_LENGTH = 2;
export const GLOBAL_SEARCH_GROUP_LIMIT = 4;

export const INTERNAL_ENTITY_ROLES = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);
export const PORTAL_ROLES = new Set(['ALUNO', 'RESPONSAVEL']);

export const navigationItems: SearchPresetItem[] = [
  {
    id: 'nav-dashboard',
    title: 'Dashboard',
    description: 'Visão geral da operação',
    href: '/dashboard',
    keywords: ['inicio', 'home', 'painel'],
    roles: ['ADMIN', 'FINANCEIRO', 'RECEPCAO'],
  },
  {
    id: 'nav-alunos',
    title: 'Alunos',
    description: 'Cadastros e acompanhamento',
    href: '/alunos',
    keywords: ['cadastro', 'estudantes'],
    roles: ['ADMIN', 'FINANCEIRO', 'RECEPCAO'],
  },
  {
    id: 'nav-responsaveis',
    title: 'Responsáveis',
    description: 'Pagadores e vínculos',
    href: '/responsaveis',
    keywords: ['financeiro', 'pagador', 'familia'],
    roles: ['ADMIN', 'FINANCEIRO', 'RECEPCAO'],
  },
  {
    id: 'nav-matriculas',
    title: 'Matrículas',
    description: 'Contratos acadêmicos ativos',
    href: '/matriculas',
    keywords: ['inscricao', 'rematricula'],
    roles: ['ADMIN', 'FINANCEIRO', 'RECEPCAO'],
  },
  {
    id: 'nav-cobrancas',
    title: 'Cobranças',
    description: 'Mensalidades e cobranças avulsas',
    href: '/cobrancas',
    keywords: ['pagamento', 'financeiro', 'mensalidade'],
    roles: ['ADMIN', 'FINANCEIRO', 'RECEPCAO'],
  },
  {
    id: 'nav-contratos',
    title: 'Contratos',
    description: 'Assinaturas e modelos',
    href: '/contratos',
    keywords: ['assinatura', 'documento'],
    roles: ['ADMIN', 'FINANCEIRO', 'RECEPCAO'],
  },
  {
    id: 'nav-notificacoes',
    title: 'Notificações',
    description: 'Central de atualizações',
    href: '/notificacoes',
    keywords: ['inbox', 'avisos'],
  },
  {
    id: 'nav-portal-inicio',
    title: 'Portal',
    description: 'Resumo do aluno e responsável',
    href: '/portal',
    keywords: ['portal', 'inicio'],
    roles: ['ALUNO', 'RESPONSAVEL'],
  },
  {
    id: 'nav-portal-matriculas',
    title: 'Portal Matrículas',
    description: 'Matrículas do portal',
    href: '/portal/matriculas',
    keywords: ['portal', 'matriculas'],
    roles: ['ALUNO', 'RESPONSAVEL'],
  },
  {
    id: 'nav-portal-financeiro',
    title: 'Portal Financeiro',
    description: 'Cobranças e pagamentos do portal',
    href: '/portal/financeiro',
    keywords: ['portal', 'financeiro', 'pagamentos'],
    roles: ['ALUNO', 'RESPONSAVEL'],
  },
  {
    id: 'nav-portal-eventos',
    title: 'Portal Eventos',
    description: 'Agenda e próximos eventos',
    href: '/portal/eventos',
    keywords: ['portal', 'eventos', 'agenda'],
    roles: ['ALUNO', 'RESPONSAVEL'],
  },
];

export const actionItems: SearchPresetItem[] = [
  {
    id: 'action-nova-venda',
    title: 'Nova venda',
    description: 'Abrir fluxo de venda',
    href: '/vendas/nova',
    keywords: ['criar venda', 'vendas'],
    roles: ['ADMIN', 'FINANCEIRO', 'RECEPCAO'],
  },
  {
    id: 'action-novo-produto',
    title: 'Novo produto',
    description: 'Cadastrar item de venda',
    href: '/vendas/produtos/novo',
    keywords: ['produto', 'cadastro produto'],
    roles: ['ADMIN', 'FINANCEIRO'],
  },
  {
    id: 'action-abrir-notificacoes',
    title: 'Abrir notificações',
    description: 'Ir para a caixa de entrada',
    href: '/notificacoes',
    keywords: ['avisos', 'inbox'],
  },
  {
    id: 'action-minha-conta',
    title: 'Minha conta',
    description: 'Perfil e preferências',
    href: '/conta',
    keywords: ['perfil', 'configuracoes'],
  },
];

export type { SearchPresetItem };
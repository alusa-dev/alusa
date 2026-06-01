import {
  BarChart3,
  CalendarClock,
  CreditCard,
  FileCheck2,
  Landmark,
  LockKeyhole,
  ReceiptText,
  ShieldCheck,
  UsersRound,
  Workflow
} from '@/features/site/components/icons/icons';
import type { HomePageDto } from '@/features/site/lib/site-dtos';

export const homePage = {
  hero: {
    title: 'Gestão escolar, financeira e',
    accent: 'operacional em uma única plataforma.',
    description:
      'A Alusa unifica operação acadêmica e financeira para sua equipe ganhar velocidade, previsibilidade e mais controle no dia a dia.',
    ctas: [
      { label: 'Criar conta grátis', href: '/register', variant: 'primary' },
      { label: 'Conhecer plataforma', sectionId: 'modulos', variant: 'secondary' }
    ]
  },
  proof: {
    label: 'Tudo que sua operação precisa em um único sistema',
    items: ['Matrículas', 'Aulas', 'Família', 'Financeiro', 'Controle', 'Resultados']
  },
  problem: {
    title: 'Sua escola não deveria operar em vários sistemas ao mesmo tempo.',
    body: [
      'Cobranças em uma plataforma, alunos em outra, contratos espalhados e processos manuais criam retrabalho, atrasos e perda de controle operacional.',
      'A Alusa centraliza gestão acadêmica, financeira e operacional em uma única experiência integrada.'
    ],
    items: [
      'Planilhas soltas',
      'WhatsApp financeiro',
      'Boletos manuais',
      'Tarefas duplicadas',
      'Sistemas desconectados',
      'Dados sem rastreabilidade'
    ]
  },
  modules: [
    {
      title: 'Matrículas e rematrículas',
      description: 'Organize admissões, renovações, contratos e acompanhamento da jornada do aluno.',
      icon: UsersRound
    },
    {
      title: 'Financeiro\nintegrado',
      description: 'Cobranças por Pix, boleto e cartão com recorrência e acompanhamento financeiro em tempo real.',
      icon: ReceiptText
    },
    {
      title: 'Turmas e\nagenda',
      description: 'Gerencie horários, aulas, capacidade, frequência e organização operacional da escola.',
      icon: CalendarClock
    },
    {
      title: 'Portal do\nresponsável',
      description: 'Acesso centralizado para pagamentos, contratos, comunicados e informações acadêmicas.',
      icon: LockKeyhole
    },
    {
      title: 'Atendimento e operação',
      description: 'Centralize processos internos, acompanhamento da equipe e rotinas administrativas.',
      icon: Workflow
    },
    {
      title: 'Indicadores e previsibilidade',
      description: 'Acompanhe métricas financeiras e operacionais para tomar decisões com mais segurança.',
      icon: BarChart3
    }
  ],
  financial: {
    title: 'Cobranças e pagamentos conectados à operação\nda sua escola.',
    body: 'A Alusa conecta contratos, cobranças recorrentes e pagamentos ao fluxo acadêmico da instituição, eliminando controles paralelos, reduzindo processos manuais e dando à equipe uma operação financeira mais clara, integrada e confiável.'
  },
  automation: {
    title: 'Menos tarefas manuais.\nMais eficiência operacional.',
    body: 'Automatize cobranças recorrentes, confirmações,\nvencimentos, acompanhamento financeiro e processos operacionais\npara sua equipe focar no crescimento da\u00a0escola.',
    bullets: [
      'Cobranças automáticas',
      'Recorrência mensal',
      'Gestão centralizada',
      'Acompanhamento financeiro',
      'Processos integrados',
      'Menos retrabalho operacional'
    ]
  },
  flow: {
    title: 'Uma jornada integrada do aluno ao pagamento.',
    steps: [
      { label: 'Cadastro do aluno', icon: UsersRound },
      { label: 'Matrícula', icon: FileCheck2 },
      { label: 'Contrato', icon: ReceiptText },
      { label: 'Cobrança', icon: Landmark },
      { label: 'Pagamento', icon: CreditCard },
      { label: 'Acompanhamento', icon: BarChart3 }
    ],
    body: 'Todos os processos conectados em uma única plataforma para reduzir retrabalho, falhas operacionais e perda de informação.'
  },
  benefits: {
    title: 'Sua equipe ganha velocidade para focar no que realmente importa.',
    items: [
      { title: 'Menos retrabalho', body: 'Processos automatizados e centralizados.' },
      { title: 'Mais controle', body: 'Visibilidade financeira e operacional em tempo real.' },
      { title: 'Mais previsibilidade', body: 'Acompanhe cobranças, contratos e recorrência com clareza.' },
      { title: 'Operação integrada', body: 'Acadêmico e financeiro funcionando juntos.' }
    ]
  },
  faq: {
    title: 'Tem dúvidas? Relaxa,\nnós temos as respostas.',
    description:
      'Selecionamos algumas dúvidas que recebemos com frequência sobre a Alusa. Elas podem ajudar você a entender como a plataforma funciona no dia a dia da sua escola.',
    items: [
      {
        question: 'O que é a Alusa e para quem ela serve?',
        answer:
          'A Alusa é uma plataforma de gestão escolar, financeira e operacional voltada a instituições com receita recorrente, como escolas, cursos, academias e negócios com matrículas, turmas e mensalidades.\n\nEm um único ambiente, você centraliza matrículas, contratos, cobranças, agenda e portal do responsável.'
      },
      {
        question: 'Quais formas de pagamento são aceitas na plataforma?',
        answer:
          'A plataforma permite cobranças por Pix, boleto e cartão, com suporte a pagamentos recorrentes.\n\nTudo fica conectado à rotina acadêmica e financeira da escola, com acompanhamento de status e histórico em tempo real.'
      },
      {
        question: 'A Alusa substitui os sistemas que já usamos na escola?',
        answer:
          'A Alusa ajuda a reduzir o uso de planilhas, ferramentas desconectadas e processos manuais. Muitas escolas passam a concentrar matrículas, financeiro, turmas e comunicação com as famílias em um só lugar.\n\nNa demonstração, avaliamos a rotina da sua instituição e definimos o que faz sentido migrar ou integrar.'
      },
      {
        question: 'O portal do responsável está incluído?',
        answer:
          'Sim. Pelo portal, os responsáveis acompanham pagamentos, contratos, comunicados e informações acadêmicas em um único lugar.\n\nCom isso, a equipe reduz retrabalho com cobranças e atendimentos repetitivos.'
      },
      {
        question: 'Como funciona a cobrança recorrente e o financeiro integrado?',
        answer:
          'A partir de contratos e matrículas, a plataforma gera cobranças automáticas conforme o plano definido pela escola.\n\nVencimentos, confirmações de pagamento e inadimplência ficam visíveis para a equipe, sem controles paralelos em planilhas ou mensagens avulsas.'
      },
      {
        question: 'Preciso de uma equipe de TI para implementar?',
        answer:
          'Não necessariamente. A Alusa foi pensada para equipes administrativas e financeiras.\n\nNa demonstração, alinhamos os cadastros iniciais, os fluxos da escola e a ordem ideal de adoção da plataforma.'
      },
      {
        question: 'Os dados da escola estão seguros?',
        answer:
          'A plataforma prioriza organização, rastreabilidade e controle operacional. Processos e movimentações ficam centralizados para dar mais previsibilidade à gestão.\n\nTambém adotamos práticas compatíveis com o dia a dia de instituições que lidam com cobranças e dados sensíveis de alunos e responsáveis.'
      }
    ]
  }
} as const satisfies HomePageDto;

export { ShieldCheck };

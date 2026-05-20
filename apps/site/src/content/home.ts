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
} from '@/components/icons/icons';
import type { HomePageDto } from '@/lib/site-dtos';

export const homePage = {
  hero: {
    title: 'Gestão escolar, financeira e',
    accent: 'operacional em uma única plataforma.',
    description:
      'A Alusa unifica operação acadêmica e financeira para sua equipe ganhar velocidade, previsibilidade e mais controle no dia a dia.',
    ctas: [
      { label: 'Agendar demonstração', href: 'mailto:contato@alusa.app', variant: 'primary' },
      { label: 'Conhecer plataforma', href: '#modulos', variant: 'secondary' }
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
    title: 'Cobranças e pagamentos conectados à operação da sua escola.',
    body: 'A Alusa conecta contratos, cobranças recorrentes e pagamentos ao fluxo acadêmico da instituição, eliminando controles paralelos, reduzindo processos manuais e dando à equipe uma operação financeira mais clara, integrada e confiável.'
  },
  automation: {
    title: 'Menos tarefas manuais. Mais eficiência operacional.',
    body: 'Automatize cobranças recorrentes, confirmações, vencimentos, acompanhamento financeiro e processos operacionais para sua equipe focar no crescimento da escola.',
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
  trust: {
    eyebrow: 'Segurança',
    title: 'Controle e previsibilidade para operações recorrentes.',
    body: 'A Alusa foi desenvolvida para escolas que precisam de organização financeira, rastreabilidade operacional e controle sobre a rotina acadêmica.',
    items: [
      {
        title: 'Financeiro integrado',
        body: 'Cobranças e pagamentos conectados à operação.'
      },
      {
        title: 'Histórico operacional',
        body: 'Acompanhamento centralizado de processos e movimentações.'
      },
      {
        title: 'Gestão centralizada',
        body: 'Informações organizadas em uma única plataforma.'
      }
    ]
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
  cta: {
    title: 'Modernize a operação da sua escola.',
    body: 'Conheça como a Alusa pode centralizar processos acadêmicos, operacionais e financeiros em uma única plataforma.',
    ctas: [
      { label: 'Agendar demonstração', href: 'mailto:contato@alusa.app', variant: 'primary' },
      { label: 'Conhecer plataforma', href: '#modulos', variant: 'secondary' }
    ]
  }
} as const satisfies HomePageDto;

export { ShieldCheck };

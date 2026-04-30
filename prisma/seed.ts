import { PrismaClient, Role, PeriodicidadePlano } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function ensureConta() {
  const conta = await prisma.conta.upsert({
    where: { id: 'conta-default' },
    update: { nome: 'Escola Exemplo', cpfCnpj: '00000000000191' },
    create: {
      id: 'conta-default',
      nome: 'Escola Exemplo',
      cpfCnpj: '00000000000191',
    },
  });
  // Vincula ou cria um FinanceProfile para a conta
  let financeProfile = await prisma.financeProfile.findFirst({ where: { contaId: conta.id } });
  if (!financeProfile) {
    financeProfile = await prisma.financeProfile.create({
      data: {
        contaId: conta.id,
        status: 'APPROVED', // valor válido do enum FinanceProfileRegulatoryStatus
      },
    });
  }
  // Cria AsaasAccount se não existir
  let asaasAccount = await prisma.asaasAccount.findFirst({ where: { financeProfileId: financeProfile.id } });
  if (!asaasAccount) {
    asaasAccount = await prisma.asaasAccount.create({
      data: {
        financeProfileId: financeProfile.id,
        apiKeyEncrypted: 'iv:salt:authTag:encryptedData', // Substitua pelo valor real criptografado
        apiKeyStatus: 'CONNECTED',
        status: 'APPROVED',
      },
    });
    console.log('[seed] AsaasAccount criado para conta-default:', asaasAccount.id);
  }
  console.log('[seed] conta pronta', { id: conta.id, nome: conta.nome });
  return conta;
}

async function seedAlunos(contaId: string) {
  const responsavel = await prisma.responsavel.upsert({
    where: { contaId_email: { contaId, email: 'mae@example.com' } },
    update: {},
    create: {
      contaId,
      nome: 'Maria Silva',
      cpf: '12345678900',
      email: 'mae@example.com',
      telefone: '(11) 98888-9999',
      financeiro: true,
    },
  });

  await prisma.aluno.upsert({
    where: { contaId_email: { contaId, email: 'aluno18@example.com' } },
    update: {},
    create: {
      contaId,
      nome: 'Joao Souza',
      dataNasc: new Date('2000-05-15'),
      email: 'aluno18@example.com',
      telefone: '(11) 97777-8888',
      status: 'ATIVO',
    },
  });

  const alunoMenor = await prisma.aluno.upsert({
    where: { contaId_email: { contaId, email: 'aluno15@example.com' } },
    update: {},
    create: {
      contaId,
      nome: 'Ana Souza',
      dataNasc: new Date('2010-08-20'),
      email: 'aluno15@example.com',
      status: 'ATIVO',
    },
  });

  const jaVinculado = await prisma.alunoResponsavel.findFirst({
    where: { alunoId: alunoMenor.id, responsavelId: responsavel.id },
  });
  if (!jaVinculado) {
    await prisma.alunoResponsavel.create({
      data: { alunoId: alunoMenor.id, responsavelId: responsavel.id, tipoVinculo: 'MAE' },
    });
  }

  console.log('[seed] alunos exemplo prontos', {
    alunos: ['aluno18@example.com', 'aluno15@example.com'],
    responsavel: responsavel.email,
  });
}

async function seedModalidadeSala(contaId: string) {
  const modalidade = await prisma.modalidade.upsert({
    where: { uq_modalidade_conta_nome: { contaId, nome: 'Ballet' } },
    update: { status: 'ATIVO', descricao: 'Aulas de Ballet Clássico' },
    create: { contaId, nome: 'Ballet', status: 'ATIVO', descricao: 'Aulas de Ballet Clássico' },
  });
  await prisma.modalidade.upsert({
    where: { uq_modalidade_conta_nome: { contaId, nome: 'Jazz' } },
    update: { status: 'ATIVO', descricao: 'Dança Jazz para vários níveis' },
    create: { contaId, nome: 'Jazz', status: 'ATIVO', descricao: 'Dança Jazz para vários níveis' },
  });
  const salaPrincipal = await prisma.sala.upsert({
    where: { uq_sala_conta_nome: { contaId, nome: 'Sala Principal' } },
    update: { status: 'ATIVO', capacidade: 30 },
    create: {
      contaId,
      nome: 'Sala Principal',
      capacidade: 30,
      status: 'ATIVO',
      descricao: 'Sala ampla principal',
    },
  });
  const salaSecundaria = await prisma.sala.upsert({
    where: { uq_sala_conta_nome: { contaId, nome: 'Sala Secundária' } },
    update: { status: 'ATIVO', capacidade: 15 },
    create: {
      contaId,
      nome: 'Sala Secundária',
      capacidade: 15,
      status: 'ATIVO',
      descricao: 'Sala de apoio menor',
    },
  });
  return { modalidade, sala: salaPrincipal, salaSecundaria };
}

async function seedTurmas(contaId: string, modalidadeId: string, salaId: string) {
  const dados = [
    {
      id: 'turma-ballet-iniciante',
      nome: 'Ballet Iniciante',
      diasSemana: ['SEG', 'QUA', 'DOM'],
      horaInicio: '18:00',
      horaFim: '19:00',
      capacidade: 20,
    },
  ];
  const turmas: { id: string; nome: string }[] = [];
  for (const d of dados) {
    const turma = await prisma.turma.upsert({
      where: { id: d.id },
      update: {
        nome: d.nome,
        diasSemana: d.diasSemana,
        horaInicio: d.horaInicio,
        horaFim: d.horaFim,
        capacidade: d.capacidade,
        modalidadeId,
        salaId,
        contaId,
        status: 'ATIVO',
      },
      create: {
        id: d.id,
        contaId,
        nome: d.nome,
        diasSemana: d.diasSemana,
        horaInicio: d.horaInicio,
        horaFim: d.horaFim,
        capacidade: d.capacidade,
        modalidadeId,
        salaId,
        status: 'ATIVO',
      },
    });
    turmas.push({ id: turma.id, nome: turma.nome });
  }
  console.log(
    '[seed] turmas prontas',
    turmas.map((t) => ({ id: t.id, nome: t.nome })),
  );
  return turmas;
}

async function seedPlanos(contaId: string) {
  const planosData: Array<{
    nome: string;
    descricao: string;
    periodicidade: PeriodicidadePlano;
    valor: string;
  }> = [
    {
      nome: 'Mensal 1x/semana - R$ 165',
      descricao: 'Inclui uma aula semanal com cobrança mensal.',
      periodicidade: 'MENSAL' as PeriodicidadePlano,
      valor: '165.00',
    },
    {
      nome: 'Trimestral ilimitado - R$ 780',
      descricao: 'Acesso ilimitado com cobrança trimestral.',
      periodicidade: 'TRIMESTRAL' as PeriodicidadePlano,
      valor: '780.00',
    },
  ];

  const planos = [];
  for (const data of planosData) {
    const plano = await prisma.plano.upsert({
      where: { uq_plano_conta_nome: { contaId, nome: data.nome } },
      update: {
        descricao: data.descricao,
        periodicidade: data.periodicidade,
        valor: data.valor,
        status: 'ATIVO',
      },
      create: {
        contaId,
        nome: data.nome,
        descricao: data.descricao,
        periodicidade: data.periodicidade,
        valor: data.valor,
      },
    });
    planos.push(plano);
  }

  console.log(
    '[seed] planos prontos',
    planos.map((p) => ({ id: p.id, nome: p.nome, valor: p.valor })),
  );
  return planos;
}

async function seedCombo(contaId: string, turmaIds: string[]) {
  const combo = await prisma.combo.upsert({
    where: { uq_combo_conta_nome: { contaId, nome: 'Ballet + Jazz' } },
    update: {
      descricao: 'Pacote combinando Ballet Iniciante e Jazz Intermediario',
      status: 'ATIVO',
    },
    create: {
      contaId,
      nome: 'Ballet + Jazz',
      descricao: 'Pacote combinando Ballet Iniciante e Jazz Intermediario',
      valor: 200,
    },
  });
  // Inserção em lote evitando duplicados (chave não única declarada no schema original, usamos verificação manual)
  const existentes = await prisma.comboTurma.findMany({ where: { comboId: combo.id } });
  const jaSet = new Set(existentes.map((e) => e.turmaId));
  const novos = turmaIds
    .filter((id) => !jaSet.has(id))
    .map((turmaId) => ({ comboId: combo.id, turmaId }));
  if (novos.length) await prisma.comboTurma.createMany({ data: novos });

  console.log('[seed] combo pronto', { id: combo.id, nome: combo.nome, turmas: turmaIds });
}

async function seedDescontos(contaId: string) {
  const descontosData = [
    {
      nome: 'Desconto 10%',
      tipo: 'PERCENTUAL',
      valor: '10.00',
      escopo: 'MATRICULA',
    },
    {
      nome: 'Bolsa R$50',
      tipo: 'FIXO',
      valor: '50.00',
      escopo: 'MATRICULA',
    },
  ];

  const descontos = [];
  for (const data of descontosData) {
    const desconto = await prisma.desconto.upsert({
      where: { uq_desconto_conta_nome: { contaId, nome: data.nome } },
      update: {
        tipo: data.tipo,
        valor: data.valor,
        escopo: data.escopo,
        status: 'ATIVO',
      },
      create: {
        contaId,
        nome: data.nome,
        tipo: data.tipo,
        valor: data.valor,
        escopo: data.escopo,
      },
    });
    descontos.push(desconto);
  }

  console.log(
    '[seed] descontos prontos',
    descontos.map((d) => ({ id: d.id, nome: d.nome, tipo: d.tipo })),
  );
  return descontos;
}

async function seedProfessores(contaId: string) {
  // Upsert idempotente por contaId + email (chave composta multi-tenant)
  const email = 'professor@example.com';
  const nome = 'Professor Exemplo';
  const telefoneCel = '11999999999';
  const miniBio = 'Instrutor de Ballet';
  const cpf = '12345678901'; // dado fictício apenas para ambiente de desenvolvimento
  const dataNasc = new Date('1990-01-01');

  // O modelo Professor exige: contaId, nome, cpf, dataNasc, email, telefoneCel (+ campos opcionais)
  const prof = await prisma.professor.upsert({
    where: { contaId_email: { contaId, email } },
    update: { nome, telefoneCel, miniBio, status: 'ATIVO' },
    create: { contaId, nome, email, telefoneCel, miniBio, status: 'ATIVO', cpf, dataNasc },
  });

  console.log('[seed] professor pronto', { id: prof.id, nome: prof.nome, email: prof.email });
}

async function seedReceitas(contaId: string) {
  const baseAno = 2024;
  const meses = [1, 2, 3, 4, 5, 6, 7];

  for (const mes of meses) {
    const dataRef = new Date(baseAno, mes - 1, 5);

    await prisma.receitaDashboard.upsert({
      where: {
        contaId_ano_mes: {
          contaId,
          ano: baseAno,
          mes,
        },
      },
      update: {
        valorTotal: 2000 + mes * 500,
      },
      create: {
        contaId,
        ano: baseAno,
        mes,
        valorTotal: 2000 + mes * 500,
        dataReferencia: dataRef,
      },
    });
  }

  console.log('[seed] receitas ficticias prontas', {
    ano: baseAno,
    meses,
  });
}

async function main() {
  const conta = await ensureConta();
  const { modalidade, sala } = await seedModalidadeSala(conta.id);
  const turmas = await seedTurmas(conta.id, modalidade.id, sala.id);
  const planos = await seedPlanos(conta.id);
  await seedCombo(
    conta.id,
    turmas.map((t) => t.id),
  );
  const descontos = await seedDescontos(conta.id);
  await seedProfessores(conta.id);
  await seedAlunos(conta.id);
  // await seedReceitas(conta.id); // Modelo ReceitaDashboard não existe mais

  // Matrícula elegível para rematrícula (contrato encerrado)
  const aluno = await prisma.aluno.findFirst({ where: { contaId: conta.id } });
  const plano = await prisma.plano.findFirst({ where: { contaId: conta.id } });
  const turma = await prisma.turma.findFirst({ where: { contaId: conta.id } });
  const responsavel = await prisma.responsavel.findFirst({ where: { email: 'mae@example.com' } });
  if (aluno && plano && turma && responsavel) {
    await prisma.matricula.create({
      data: {
        alunoId: aluno.id,
        planoId: plano.id,
        turmaId: turma.id,
        responsavelFinanceiroId: responsavel.id,
        dataInicio: new Date('2024-01-01'),
        dataFim: new Date('2024-10-01'),
        dataFimContrato: new Date('2024-10-01'),
        status: 'CANCELADA', // status que permite renovação
        statusFinanceiro: 'ADIMPLENTE',
        statusContrato: 'EXPIRADO',
        taxaMatricula: 100,
        taxaStatus: 'PAGO',
        taxaIsenta: false,
        vencimentoDia: 5,
        multaPercentual: 2,
        jurosMensal: 1,
      },
    });
    console.log('[seed] matrícula elegível para rematrícula criada');
  }

  // ==== Usuário administrador padrão (para login inicial) ====
  // IMPORTANTE: Estas credenciais são apenas para ambiente de DESENVOLVIMENTO.
  // Em produção faça UM DOS SEGUINTES imediatamente após o deploy:
  // 1) Altere a senha deste usuário;
  // 2) Remova este bloco do seed e crie usuários via fluxo oficial de onboarding;
  // 3) Ajuste variáveis BCRYPT_ROUNDS / BCRYPT_PEPPER para valores fortes.
  // Nunca mantenha senhas padrão conhecidas em produção.
  const adminEmail = 'admin@example.com';
  const adminSenhaPlain = 'Admin123!'; // mínimo: 8 chars, maiúscula, minúscula, número, especial
  const pepper = process.env.BCRYPT_PEPPER || '';
  const rounds = Number(process.env.BCRYPT_ROUNDS || 10);
  const senhaHash = await bcrypt.hash(adminSenhaPlain + pepper, rounds);
  await prisma.usuario.upsert({
    where: { email: adminEmail },
    update: { nome: 'Administrador', role: Role.ADMIN },
    create: {
      contaId: conta.id,
      nome: 'Administrador',
      email: adminEmail,
      senhaHash,
      role: Role.ADMIN,
    },
  });
  console.log('[seed] usuario admin pronto', { email: adminEmail, senha: adminSenhaPlain });

  const alunoEmail = 'aluno@example.com';
  const alunoSenhaPlain = 'senha123';
  const alunoSenhaHash = await bcrypt.hash(alunoSenhaPlain + pepper, rounds);
  await prisma.usuario.upsert({
    where: { email: alunoEmail },
    update: { nome: 'Aluno Seed', role: Role.RESPONSAVEL, contaId: conta.id },
    create: {
      contaId: conta.id,
      nome: 'Aluno Seed',
      email: alunoEmail,
      senhaHash: alunoSenhaHash,
      role: Role.RESPONSAVEL,
    },
  });
  console.log('[seed] usuario aluno pronto', { email: alunoEmail, senha: alunoSenhaPlain });
  console.log('[seed] resumo IDs', {
    conta: conta.id,
    turmas: turmas.map((t) => t.id),
    planos: planos.map((p) => p.id),
    descontos: descontos.map((d) => d.id),
  });
  console.log('[seed] concluido');
}

main()
  .catch((e) => {
    console.error('[seed] erro', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

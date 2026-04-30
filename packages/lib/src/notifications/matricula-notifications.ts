/**
 * Serviço para enviar notificações ao responsável sobre ações de matrícula
 */

import { prisma } from '../prisma';

export interface NotifyMatriculaActionInput {
  matriculaId: string;
  action: 'PAUSADA' | 'RETOMADA' | 'CANCELADA';
  motivo?: string;
  contaId: string;
}

export interface NotificationResult {
  success: boolean;
  message: string;
  channels: {
    email?: boolean;
    sms?: boolean;
    whatsapp?: boolean;
  };
}

/**
 * Envia notificação ao responsável sobre ações de matrícula
 * 
 * NOTA: Por enquanto, apenas registra a intenção de notificar.
 * O Asaas notifica automaticamente quando:
 * - PAUSADA: Cliente para de receber cobranças
 * - RETOMADA: Nova cobrança é gerada → Asaas envia notificação automática
 * - CANCELADA: Cliente para de receber cobranças
 */
export async function notifyMatriculaAction(
  input: NotifyMatriculaActionInput
): Promise<NotificationResult> {
  try {
    // Buscar informações da matrícula e responsável
    const matricula = await prisma.matricula.findFirst({
      where: {
        id: input.matriculaId,
        aluno: { contaId: input.contaId },
      },
      include: {
        aluno: {
          include: {
            responsaveis: {
              where: {
                OR: [{ tipoVinculo: 'FINANCEIRO' }, { tipoVinculo: 'PRINCIPAL' }],
              },
              include: {
                responsavel: true,
              },
              take: 1,
            },
          },
        },
        turma: true,
        plano: true,
      },
    });

    if (!matricula) {
      return {
        success: false,
        message: 'Matrícula não encontrada',
        channels: {},
      };
    }

    const responsavel = matricula.aluno.responsaveis[0]?.responsavel;

    if (!responsavel || !responsavel.email) {
      console.warn(
        `[NOTIFICACAO_MATRICULA] Responsável sem email para matrícula ${input.matriculaId}`
      );
      return {
        success: false,
        message: 'Responsável não possui email cadastrado',
        channels: {},
      };
    }

    // Preparar dados da notificação
    const actionTexts = {
      PAUSADA: {
        title: 'Matrícula Pausada',
        message: `A matrícula de ${matricula.aluno.nome} foi pausada temporariamente. As cobranças mensais serão suspensas até que a matrícula seja retomada.`,
      },
      RETOMADA: {
        title: 'Matrícula Retomada',
        message: `A matrícula de ${matricula.aluno.nome} foi retomada. As cobranças mensais serão reiniciadas e você receberá um novo boleto/cobrança em breve.`,
      },
      CANCELADA: {
        title: 'Matrícula Cancelada',
        message: `A matrícula de ${matricula.aluno.nome} foi cancelada. Não haverá mais cobranças mensais. Agradecemos por ter feito parte da nossa escola.`,
      },
    };

    const notification = actionTexts[input.action];

    // Registrar log de notificação (intenção)
    await prisma.logFinanceiro.create({
      data: {
        contaId: input.contaId,
        acao: `NOTIFICACAO_${input.action}`,
        detalhes: {
          matriculaId: input.matriculaId,
          action: input.action,
          motivo: input.motivo,
          responsavelEmail: responsavel.email,
          responsavelNome: responsavel.nome,
          alunoNome: matricula.aluno.nome,
          turma: matricula.turma?.nome,
          plano: matricula.plano?.nome,
          notificationTitle: notification.title,
          notificationMessage: notification.message,
          timestamp: new Date().toISOString(),
          // Por enquanto, apenas registramos a intenção
          // O Asaas notifica automaticamente quando há mudanças em cobranças
          asaasAutomatic: true,
          note: 'O Asaas notificará automaticamente o cliente quando houver mudanças em cobranças (retomada = nova cobrança gerada)',
        },
        usuarioId: process.env.SYSTEM_USER_ID || 'system',
      },
    });

    console.log(`[NOTIFICACAO_MATRICULA] Registrada notificação de ${input.action} para matrícula ${input.matriculaId}`);

    return {
      success: true,
      message: `Notificação registrada. O Asaas notificará automaticamente o cliente sobre mudanças em cobranças.`,
      channels: {
        email: true, // Via Asaas quando houver mudanças em cobranças
        sms: false,
        whatsapp: false,
      },
    };
  } catch (error) {
    console.error('[NOTIFICACAO_MATRICULA] Erro ao enviar notificação:', error);
    return {
      success: false,
      message: (error as Error).message || 'Erro ao enviar notificação',
      channels: {},
    };
  }
}



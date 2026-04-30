'use client';

import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Share2 } from '@/components/icons/icons';
import { pushToast } from '@/components/ui/toast';
import {
  ChatBubbleLeftRightIcon,
  DocumentDuplicateIcon,
  EnvelopeIcon,
} from '@heroicons/react/24/outline';

type CobrancaCompartilharButtonProps = {
  cobranca: {
    id: string;
    asaasPaymentId?: string | null;
    matricula: {
      aluno: {
        nome: string;
        telefone?: string;
        email?: string;
      };
    };
  };
  invoiceUrl?: string;
  onNotifySuccess?: () => void;
};

export function CobrancaCompartilharButton({
  cobranca,
  invoiceUrl,
  onNotifySuccess,
}: CobrancaCompartilharButtonProps) {
  const [emailLoading, setEmailLoading] = useState(false);

  // URL da fatura só é válida se vier do provedor de pagamentos
  const faturaUrl = invoiceUrl || null;

  const handleCopiarLink = async () => {
    if (!faturaUrl) {
      pushToast({
        title: 'Link indisponível',
        description: 'O link da fatura ainda não está disponível. A cobrança precisa ser sincronizada com o provedor de pagamentos.',
        variant: 'warning',
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(faturaUrl);
      pushToast({
        title: 'Link copiado',
        description: 'O link da fatura foi copiado para a área de transferência',
        variant: 'success',
      });
    } catch {
      pushToast({
        title: 'Erro',
        description: 'Não foi possível copiar o link',
        variant: 'error',
      });
    }
  };

  const handleCompartilharWhatsApp = () => {
    const alunoNome = cobranca.matricula.aluno.nome;
    const telefone = cobranca.matricula.aluno.telefone?.replace(/\D/g, '') || '';

    if (!telefone) {
      pushToast({
        title: 'Telefone não cadastrado',
        description: 'O aluno não possui telefone cadastrado',
        variant: 'warning',
      });
      return;
    }

    if (!faturaUrl) {
      pushToast({
        title: 'Link indisponível',
        description: 'O link da fatura ainda não está disponível. A cobrança precisa ser sincronizada com o provedor de pagamentos.',
        variant: 'warning',
      });
      return;
    }

    const mensagem = `Olá ${alunoNome}! 👋\n\nSegue o link para visualizar e pagar sua cobrança:\n\n${faturaUrl}\n\nQualquer dúvida, estamos à disposição!`;
    const whatsappUrl = `https://wa.me/55${telefone}?text=${encodeURIComponent(mensagem)}`;

    window.open(whatsappUrl, '_blank');

    pushToast({
      title: 'WhatsApp aberto',
      description: 'A conversa foi aberta em uma nova aba',
      variant: 'success',
    });
  };

  const handleEnviarEmail = async () => {
    const email = cobranca.matricula.aluno.email;

    if (!email) {
      pushToast({
        title: 'E-mail não cadastrado',
        description: 'O aluno não possui e-mail cadastrado',
        variant: 'warning',
      });
      return;
    }

    if (!cobranca.asaasPaymentId) {
      pushToast({
        title: 'Indisponível',
        description: 'Esta cobrança ainda não está pronta para envio por e-mail',
        variant: 'warning',
      });
      return;
    }

    setEmailLoading(true);

    try {
      const res = await fetch(`/api/cobrancas/${cobranca.id}/asaas-notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo: 'EMAIL',
          paymentId: cobranca.asaasPaymentId,
        }),
      });

      const result = await res.json();

      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Erro ao enviar e-mail');
      }

      pushToast({
        title: 'E-mail enviado',
        description: `Cobrança enviada para ${email}`,
        variant: 'success',
      });

      onNotifySuccess?.();
    } catch (err) {
      pushToast({
        title: 'Erro',
        description: err instanceof Error ? err.message : 'Não foi possível enviar o e-mail',
        variant: 'error',
      });
    } finally {
      setEmailLoading(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          disabled={emailLoading}
          className="h-10 px-4 border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          <Share2 className="h-4 w-4 mr-2" />
          Compartilhar
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={handleCompartilharWhatsApp}>
          <ChatBubbleLeftRightIcon className="h-4 w-4 mr-2" />
          Compartilhar por WhatsApp
        </DropdownMenuItem>

        <DropdownMenuItem onClick={handleEnviarEmail} disabled={emailLoading}>
          <EnvelopeIcon className="h-4 w-4 mr-2" />
          {emailLoading ? 'Enviando...' : 'Enviar por e-mail'}
        </DropdownMenuItem>

        <DropdownMenuItem onClick={handleCopiarLink}>
          <DocumentDuplicateIcon className="h-4 w-4 mr-2" />
          Copiar link da fatura
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
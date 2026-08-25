'use client';

import { BellAlertIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ComunicacaoFeature() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-6 md:py-10">
      <Alert className="mb-6 border-violet-200 bg-violet-50">
        <ShieldCheckIcon className="h-4 w-4 text-violet-600" />
        <AlertDescription className="text-sm text-violet-900">
          O canal institucional da Alusa está em piloto controlado. Mensagens de cobrança continuam
          sob responsabilidade do Asaas; o WhatsApp da Alusa é reservado para comunicação operacional.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl md:text-2xl">
            <BellAlertIcon className="h-6 w-6 text-[#3e1f63]" aria-hidden="true" />
            Central de comunicação
          </CardTitle>
          <CardDescription>
            As notificações transacionais críticas continuam pelos canais internos e por e-mail
            quando configuradas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-relaxed text-slate-600">
          <p>
            Tickets e documentos são enviados pela Cloud API com rastreabilidade por conta, retries,
            DLQ e atualização de status por webhook.
          </p>
          <p>
            Mensagens financeiras, de matrícula, contrato e portal devem seguir a base legal
            correta e nunca expor dados sensíveis além do necessário.
          </p>
          <Link
            href="/comunicacao/whatsapp-teste"
            className="inline-flex rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-800"
          >
            Abrir página de teste do WhatsApp
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

'use client';

import { BellAlertIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ComunicacaoFeature() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-6 md:py-10">
      <Alert className="mb-6 border-amber-200 bg-amber-50">
        <ShieldCheckIcon className="h-4 w-4 text-amber-600" />
        <AlertDescription className="text-sm text-amber-800">
          Comunicação externa está pausada enquanto a Alusa revisa provedores, consentimentos e
          bases legais para mensagens operacionais e promocionais.
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
            Antes de reativar envios por mensageria, a Alusa registrará consentimentos quando
            aplicável, diferenciará comunicações operacionais de marketing e manterá trilhas
            auditáveis por conta.
          </p>
          <p>
            Mensagens financeiras, de matrícula, contrato e portal devem seguir a base legal
            correta e nunca expor dados sensíveis além do necessário.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

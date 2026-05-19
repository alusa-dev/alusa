'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import InputMask from 'react-input-mask';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  CheckCircleIcon,
  XCircleIcon,
  PaperAirplaneIcon,
  ClockIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';
import { ArrowPathIcon } from '@heroicons/react/24/solid';
import { useTwilioSend } from './hooks/use-twilio-send';
import { InfoCallout } from '@/components/ui/info-callout';

/**
 * Feature de Comunicação - Teste Sandbox WhatsApp via Twilio
 *
 * Página para testes de envio de mensagens WhatsApp usando o Twilio Sandbox.
 * Não deve ser usada em produção - apenas para validação da integração.
 *
 * @design
 * - Mobile-first com responsividade completa
 * - Validações em tempo real com feedback visual
 * - Preview do número formatado antes do envio
 * - Estados de loading, success, error e empty
 * - Contador de tempo para operações lentas (sandbox)
 *
 * @fluxo
 * 1. Usuário digita número WhatsApp brasileiro (máscara: (DD) 9XXXX-XXXX)
 * 2. Usuário digita mensagem personalizada (máx 1000 caracteres)
 * 3. Sistema valida formato do número e presença de mensagem
 * 4. Ao clicar em "Enviar", inicia loading state
 * 5. Hook useTwilioSend chama service que formata e envia via API
 * 6. API route valida, formata para padrão Twilio (whatsapp:+55XXXXXXXXXXX)
 * 7. Twilio SDK envia mensagem e retorna SID
 * 8. Interface exibe resultado com feedback visual claro
 *
 * @responsabilidades
 * - Gerenciar estado local (inputs, timer)
 * - Validar formato de número antes de enviar
 * - Exibir feedback de todas as operações
 * - Limpar resultados ao editar campos
 *
 * @dependencies
 * - Hook: useTwilioSend (lógica de envio isolada)
 * - Service: twilio-service (comunicação com API)
 * - API Route: /api/twilio/send (validação e envio)
 * - Utils: formatarNumeroWhatsApp (formatação de números)
 */
export default function ComunicacaoFeature() {
  // Estados de formulário
  const [telefone, setTelefone] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [tempoEspera, setTempoEspera] = useState(0);

  // Hook de envio
  const { send, loading, resultado, clearResultado } = useTwilioSend();

  // Ref para timer de tempo de espera
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Limpa timer de tempo de espera ao desmontar componente
   */
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  /**
   * Handler para envio de mensagem
   * Valida dados, inicia timer e chama hook de envio
   */
  const handleEnviar = useCallback(async () => {
    const telefoneLimpo = telefone.replace(/\D/g, '');

    // Validação de segurança (botão já deveria estar desabilitado)
    if (telefoneLimpo.length !== 11 || !mensagem.trim()) {
      return;
    }

    // Limpa timer anterior se existir
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    // Inicia contador de tempo (sandbox pode demorar)
    setTempoEspera(0);
    timerRef.current = setInterval(() => {
      setTempoEspera((prev) => prev + 1);
    }, 1000);

    try {
      // Envia número formatado com máscara - backend irá formatar para Twilio
      await send(telefone, mensagem);
    } finally {
      // Para timer após envio (sucesso ou erro)
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [telefone, mensagem, send]);

  /**
   * Handler para mudança de telefone
   * Limpa resultado anterior ao editar
   */
  const handleTelefoneChange = useCallback(
    (value: string) => {
      setTelefone(value);
      if (resultado) {
        clearResultado();
      }
    },
    [resultado, clearResultado],
  );

  /**
   * Handler para mudança de mensagem
   * Limpa resultado anterior ao editar
   */
  const handleMensagemChange = useCallback(
    (value: string) => {
      setMensagem(value);
      if (resultado) {
        clearResultado();
      }
    },
    [resultado, clearResultado],
  );

  // Validações derivadas
  const telefoneLimpo = telefone.replace(/\D/g, '');
  const isNumeroValido = telefoneLimpo.length === 11;
  const isMensagemValida = mensagem.trim().length > 0;
  const isPodeEnviar = isNumeroValido && isMensagemValida && !loading;

  return (
    <div className="container mx-auto max-w-2xl px-4 py-6 md:py-10">
      {/* Header informativo */}
      <Alert className="mb-6 border-amber-200 bg-amber-50">
        <ClockIcon className="h-4 w-4 text-amber-600" />
        <AlertDescription className="text-sm text-amber-800">
          <strong>Ambiente de Teste:</strong> Esta página usa o Twilio Sandbox. Mensagens podem
          demorar 10-20 segundos. Não usar em produção.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl md:text-2xl">Teste de Comunicação WhatsApp</CardTitle>
          <CardDescription className="text-sm">
            Envie mensagens de teste via Twilio WhatsApp Sandbox para validar a integração
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Input de número com máscara brasileira */}
          <div className="space-y-2">
            <label htmlFor="telefone" className="text-sm font-medium text-slate-700">
              📱 Número do WhatsApp
            </label>
            <InputMask
              mask="(99) 99999-9999"
              value={telefone}
              onChange={(e) => handleTelefoneChange(e.target.value)}
              disabled={loading}
            >
              {(inputProps: React.InputHTMLAttributes<HTMLInputElement>) => (
                <Input
                  {...inputProps}
                  id="telefone"
                  type="tel"
                  placeholder="(11) 99999-9999"
                  className="text-base md:text-lg"
                  autoComplete="tel"
                />
              )}
            </InputMask>
            <p className="text-xs text-slate-500">
              Formato brasileiro: <code className="rounded bg-slate-100 px-1">(DD) 9XXXX-XXXX</code>
            </p>
          </div>

          {/* Preview do número formatado (válido) */}
          {isNumeroValido && (
            <Alert className="border-green-200 bg-green-50">
              <CheckCircleIcon className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-xs text-green-700">
                <strong>Número válido:</strong> Será enviado para{' '}
                <code className="rounded bg-white px-2 py-0.5 font-mono text-green-900">
                  +55{telefoneLimpo}
                </code>
              </AlertDescription>
            </Alert>
          )}

          {/* TextArea de mensagem */}
          <div className="space-y-2">
            <label htmlFor="mensagem" className="text-sm font-medium text-slate-700">
              💬 Mensagem
            </label>
            <div className="relative">
              <Textarea
                id="mensagem"
                placeholder="Digite sua mensagem de teste aqui..."
                value={mensagem}
                onChange={(e) => handleMensagemChange(e.target.value)}
                disabled={loading}
                className="min-h-[120px] resize-none rounded-2xl border-slate-300 pr-12 focus:border-green-500 focus:ring-green-500"
                maxLength={1000}
                aria-describedby="char-count"
              />
              <div
                id="char-count"
                className="absolute bottom-3 right-3 text-xs text-slate-400"
                aria-live="polite"
              >
                {mensagem.length}/1000
              </div>
            </div>
          </div>

          {/* Botão de envio */}
          <Button
            onClick={handleEnviar}
            disabled={!isPodeEnviar}
            className="w-full bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
            size="lg"
            type="button"
          >
            {loading ? (
              <>
                <ArrowPathIcon className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
                <span>Enviando mensagem...{tempoEspera > 0 && ` (${tempoEspera}s)`}</span>
              </>
            ) : (
              <>
                <PaperAirplaneIcon className="mr-2 h-5 w-5" aria-hidden="true" />
                <span>Enviar Mensagem WhatsApp</span>
              </>
            )}
          </Button>

          {/* Alerta de tempo de espera (sandbox pode ser lento) */}
          {loading && tempoEspera > 5 && (
            <Alert className="border-amber-200 bg-amber-50">
              <ClockIcon className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-sm text-amber-800">
                <strong>Aguarde...</strong> Mensagens do Sandbox podem demorar 10-20 segundos.{' '}
                {tempoEspera}s decorridos.
              </AlertDescription>
            </Alert>
          )}

          {/* Feedback de resultado (sucesso ou erro) */}
          {resultado && (
            <Alert
              className={
                resultado.tipo === 'success'
                  ? 'border-green-200 bg-green-50'
                  : 'border-red-200 bg-red-50'
              }
            >
              {resultado.tipo === 'success' ? (
                <CheckCircleIcon className="h-4 w-4 text-green-600" />
              ) : (
                <XCircleIcon className="h-4 w-4 text-red-600" />
              )}
              <AlertDescription>
                <div className="space-y-2">
                  <p
                    className={`text-sm font-medium ${
                      resultado.tipo === 'success' ? 'text-green-900' : 'text-red-900'
                    }`}
                  >
                    {resultado.mensagem}
                  </p>
                  {resultado.tipo === 'success' && resultado.sid && (
                    <div className="space-y-1">
                      <p className="text-xs text-green-700">
                        📱 <strong>Verifique seu WhatsApp agora!</strong> A mensagem pode demorar
                        até 20 segundos para chegar.
                      </p>
                      {resultado.sid && (
                        <p className="text-xs text-green-600">
                          SID:{' '}
                          <code className="bg-white px-1 rounded text-[10px]">{resultado.sid}</code>
                        </p>
                      )}
                    </div>
                  )}
                  {resultado.detalhes && (
                    <p className="mt-2 text-xs text-red-700">{resultado.detalhes}</p>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}

          <InfoCallout showIcon title="📱 Como usar:">
            <ol className="ml-4 list-decimal space-y-1.5 text-xs text-slate-600">
              <li>
                <strong>Ative seu número</strong> no{' '}
                <a
                  href="https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-[#1f6b75] underline underline-offset-2 hover:text-[#174f57]"
                >
                  Sandbox Twilio
                </a>{' '}
                (escaneie QR Code uma vez)
              </li>
              <li>
                <strong>Digite o número</strong> com DDD: <code>(11) 99999-9999</code>
              </li>
              <li>
                <strong>Escreva sua mensagem</strong> personalizada (até 1000 caracteres)
              </li>
              <li>
                <strong>Clique em &quot;Enviar WhatsApp&quot;</strong> e aguarde ~10 segundos
              </li>
            </ol>
          </InfoCallout>

          {/* Info adicional */}
          <Alert className="border-slate-200 bg-slate-50">
            <InformationCircleIcon className="h-4 w-4 text-slate-600" />
            <AlertDescription className="text-xs text-slate-600">
              <strong className="text-slate-900">💡 Dica:</strong> Para produção, configure números
              verificados no Twilio Console e substitua as variáveis de ambiente pelo{' '}
              <strong>ambiente de produção</strong>.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}

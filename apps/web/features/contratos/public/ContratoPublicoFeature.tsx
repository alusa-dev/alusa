'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/components/ui/toast';
import {
  CheckCircle as CheckCircleIcon,
  ErrorCircle as XCircleIcon,
  ClipboardDocumentCheckSolid as DocumentCheckIcon,
} from '@/components/icons/icons';
import { PDFViewer } from '../components/PDFViewer';
import { AsaasSeal } from '@/components/shared/AsaasSeal';
import { cn } from '@/lib/utils';

interface ContratoPublico {
  id: string;
  arquivoPdfUrl: string;
  hashPdf: string;
  status: 'PENDENTE' | 'ASSINADO' | 'EXPIRADO' | 'CANCELADO';
  tokenExpiraEm: string;
  matricula: {
    aluno: { nome: string };
    responsavelFinanceiro?: { nome: string };
  };
}

interface ContratoPublicoFeatureProps {
  token: string;
}

export function ContratoPublicoFeature({ token }: ContratoPublicoFeatureProps) {
  const [contrato, setContrato] = useState<ContratoPublico | null>(null);
  const [loading, setLoading] = useState(true);
  const [assinando, setAssinando] = useState(false);
  const [signedSuccess, setSignedSuccess] = useState(false);
  const [errorMSG, setErrorMSG] = useState<string | null>(null);

  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [email, setEmail] = useState('');
  const [aceite, setAceite] = useState(false);

  useEffect(() => {
    fetch(`/api/public/contrato/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error?.message || 'Erro ao carregar contrato');
        }
        return res.json();
      })
      .then((data) => {
        setContrato(data);
        // Preencher nome/cpf se disponível
        if (data.matricula.responsavelFinanceiro) {
          setNome(data.matricula.responsavelFinanceiro.nome || '');
        } else if (data.matricula.aluno) {
          setNome(data.matricula.aluno.nome || '');
        }
      })
      .catch((err) => setErrorMSG((err as Error).message))
      .finally(() => setLoading(false));
  }, [token]);

  const formatCpf = useCallback((value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
    if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }, []);

  const handleAssinar = async () => {
    if (!aceite) {
      toast.error('Você deve ler e aceitar os termos do contrato.');
      return;
    }
    if (!nome.trim()) {
      toast.error('Informe seu nome completo.');
      return;
    }
    const cpfDigits = cpf.replace(/\D/g, '');
    if (cpfDigits.length !== 11) {
      toast.error('CPF inválido.');
      return;
    }

    try {
      setAssinando(true);
      const res = await fetch(`/api/public/contrato/${token}/assinar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: nome.trim(),
          cpf: cpfDigits,
          email: email.trim() || undefined,
          userAgent: navigator.userAgent,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || 'Erro ao assinar contrato');
      }

      setSignedSuccess(true);
      toast.success('Contrato assinado com sucesso!');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setAssinando(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-accent mx-auto mb-4"></div>
          <p className="text-gray-500">Carregando contrato...</p>
        </div>
      </div>
    );
  }

  if (errorMSG) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <div className="mx-auto w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-2">
              <XCircleIcon className="w-8 h-8 text-red-600" />
            </div>
            <CardTitle className="text-red-700">Não foi possível acessar</CardTitle>
            <CardDescription>{errorMSG}</CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <p className="text-sm text-gray-500">
              Entre em contato com a escola se acreditar que isso é um erro.
            </p>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (contrato?.status === 'ASSINADO' || signedSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
              <DocumentCheckIcon className="w-10 h-10 text-green-600" />
            </div>
            <CardTitle className="text-green-700">Contrato Assinado!</CardTitle>
            <CardDescription>
              {signedSuccess
                ? 'Sua assinatura foi registrada com sucesso.'
                : 'Este contrato já foi assinado anteriormente.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600">
              Você pode fechar esta página com segurança.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (contrato?.status === 'EXPIRADO') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <div className="mx-auto w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mb-2">
              <XCircleIcon className="w-8 h-8 text-yellow-600" />
            </div>
            <CardTitle className="text-yellow-700">Link Expirado</CardTitle>
            <CardDescription>
              O prazo para assinatura deste contrato expirou.
            </CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <p className="text-sm text-gray-500">
              Solicite um novo link à instituição.
            </p>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f3f4f6]">
      {/* Header Minimalista (Whitelabel friendly) */}
      <header className="bg-white border-b sticky top-0 z-30 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-brand-accent/10 p-2 rounded-lg">
              <DocumentCheckIcon className="h-6 w-6 text-brand-accent" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-gray-900 leading-none">
                Assinatura Digital
              </h1>
              <p className="text-xs text-gray-500 mt-1">
                {contrato?.matricula.aluno.nome}
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 py-6 sm:py-8 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          
          {/* PDF Viewer - Mobile: Ordem 1, Desktop: Coluna Esq (8 cols) */}
          <div className="lg:col-span-8 order-1">
            {/* Mobile View: Call to Action button only */}
            <div className="lg:hidden mb-2">
               <Card className="bg-blue-50 border-blue-100 shadow-sm">
                  <CardContent className="p-6 text-center space-y-4">
                     <div className="mx-auto w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                        <DocumentCheckIcon className="h-6 w-6 text-blue-600" />
                     </div>
                     <div>
                        <h3 className="text-lg font-semibold text-gray-900">Ler Contrato</h3>
                        <p className="text-sm text-gray-600 mt-1">
                           Para sua segurança, clique abaixo para ler o documento completo em uma nova aba antes de assinar.
                        </p>
                     </div>
                     <Button 
                        onClick={() => contrato && window.open(contrato.arquivoPdfUrl, '_blank', 'noopener,noreferrer')}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                        size="lg"
                     >
                        Abrir PDF para Leitura
                     </Button>
                  </CardContent>
               </Card>
            </div>

            {/* Desktop View: Embedded Viewer */}
            <Card className="hidden lg:flex border-gray-200 shadow-sm overflow-hidden flex-col h-full">
              <div className="bg-gray-50 border-b px-4 py-3 flex items-center justify-between">
                 <h2 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                    <DocumentCheckIcon className="h-4 w-4 text-gray-400" />
                    Documento Original
                 </h2>
                 <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
                   Leitura Obrigatória
                 </span>
              </div>
              
              <div className="bg-gray-100 flex-1 min-h-[50vh] lg:min-h-[75vh]">
                {contrato && (
                  <PDFViewer
                    url={contrato.arquivoPdfUrl}
                    showDownload={true}
                    maxHeight="75vh" // Melhor altura para desktop
                    className="h-full w-full"
                  />
                )}
              </div>
            </Card>
          </div>

          {/* Signature Form - Mobile: Ordem 2, Desktop: Sticky Right (4 cols) */}
          <div className="lg:col-span-4 order-2 lg:sticky lg:top-24">
            <Card className="border-gray-200 shadow-lg ring-1 ring-black/5">
              <CardHeader className="bg-white border-b pb-4">
                <CardTitle className="text-lg text-gray-900">Confirmar Assinatura</CardTitle>
                <CardDescription className="text-sm">
                  Preencha os dados do responsável para validar o contrato.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 p-5 bg-gray-50/30">
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="nome" className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Nome Completo</Label>
                    <Input
                      id="nome"
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      placeholder="Ex: Maria Silva"
                      className="bg-white"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="cpf" className="text-xs font-semibold text-gray-500 uppercase tracking-wider">CPF</Label>
                    <Input
                      id="cpf"
                      value={cpf}
                      onChange={(e) => setCpf(formatCpf(e.target.value))}
                      placeholder="000.000.000-00"
                      maxLength={14}
                      className="bg-white"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Email para Cópia</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="seu@email.com"
                      className="bg-white"
                    />
                  </div>
                </div>

                <div className="bg-blue-50/50 rounded-lg p-3 border border-blue-100">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id="aceite"
                      checked={aceite}
                      onCheckedChange={(checked) => setAceite(checked === true)}
                      className="mt-1 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                    />
                    <Label htmlFor="aceite" className="text-sm text-gray-700 leading-relaxed cursor-pointer font-normal">
                      Declaro que li o documento e concordo com todos os termos e condições legais.
                    </Label>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="p-5 bg-white border-t pt-4">
                <div className="w-full space-y-4">
                  <Button
                    onClick={handleAssinar}
                    disabled={assinando || !aceite}
                    className={cn(
                      "w-full h-11 text-base transition-all",
                      assinando ? "bg-gray-100 text-gray-400" : "bg-green-600 hover:bg-green-700 text-white shadow-md hover:shadow-lg"
                    )}
                  >
                    {assinando ? (
                      <>
                        <span className="animate-spin mr-2 h-4 w-4 border-2 border-gray-400 border-t-transparent rounded-full" />
                        Registrando...
                      </>
                    ) : (
                      <>
                        <CheckCircleIcon className="h-5 w-5 mr-2" />
                        Assinar Digitalmente
                      </>
                    )}
                  </Button>
                </div>
              </CardFooter>
            </Card>
            
            <div className="mt-6 text-center">
              <p className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold flex items-center justify-center gap-2">
                <span className="h-px w-8 bg-gray-300"></span>
                Ambiente Auditado
                <span className="h-px w-8 bg-gray-300"></span>
              </p>
              <div className="mt-3 flex justify-center">
                <AsaasSeal variant="negativo-preto" />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

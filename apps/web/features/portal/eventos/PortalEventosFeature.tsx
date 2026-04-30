'use client';

import type { ComponentType } from 'react';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  Calendar,
  AlertCircle,
  MapPin,
  Users,
  Ticket,
  Download,
} from '@/components/icons/icons';
import { Skeleton } from '@/components/ui/skeleton';
import { QRCodeSVG } from 'qrcode.react';
import type { PortalEventoDTO } from '@/features/portal/dtos';

export function PortalEventosFeature() {
  const { data: session } = useSession();
  const [eventos, setEventos] = useState<PortalEventoDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEvento, setSelectedEvento] = useState<PortalEventoDTO | null>(null);

  useEffect(() => {
    async function loadEventos() {
      try {
        setLoading(true);
        const response = await fetch('/api/portal/eventos');
        if (!response.ok) {
          throw new Error('Erro ao carregar eventos');
        }
        const result = await response.json();
        setEventos(result.eventos || []);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }

    if (session?.user) {
      loadEventos();
    }
  }, [session]);

  const eventosInscritos = eventos.filter((e) => e.inscricao);
  const eventosDisponiveis = eventos.filter((e) => !e.inscricao && e.status === 'ATIVO');

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-96" />
        <div className="space-y-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
        <AlertCircle className="h-5 w-5" />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Eventos</h1>
        <p className="mt-2 text-gray-600">Confira eventos disponíveis e seus ingressos</p>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <SummaryCard
          title="Eventos Inscritos"
          value={eventosInscritos.length.toString()}
          icon={Ticket}
          variant="violet"
        />
        <SummaryCard
          title="Eventos Disponíveis"
          value={eventosDisponiveis.length.toString()}
          icon={Calendar}
          variant="blue"
        />
      </div>

      {/* Eventos Inscritos */}
      {eventosInscritos.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900">Meus Eventos</h2>
          {eventosInscritos.map((evento) => (
            <EventoCard
              key={evento.id}
              evento={evento}
              onViewQRCode={() => setSelectedEvento(evento)}
            />
          ))}
        </div>
      )}

      {/* Eventos Disponíveis */}
      {eventosDisponiveis.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900">Eventos Disponíveis</h2>
          {eventosDisponiveis.map((evento) => (
            <EventoCard key={evento.id} evento={evento} />
          ))}
        </div>
      )}

      {/* Empty State */}
      {eventos.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-xl border border-gray-200">
          <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">Nenhum evento disponível</h3>
          <p className="mt-2 text-gray-600">
            Não há eventos cadastrados no momento.
          </p>
        </div>
      )}

      {/* Modal QR Code */}
      {selectedEvento && selectedEvento.inscricao && (
        <QRCodeModal
          evento={selectedEvento}
          onClose={() => setSelectedEvento(null)}
        />
      )}
    </div>
  );
}

type SummaryIcon = ComponentType<{ className?: string }>;

function SummaryCard({
  title,
  value,
  icon: Icon,
  variant,
}: {
  title: string;
  value: string;
  icon: SummaryIcon;
  variant: 'violet' | 'blue';
}) {
  const colors = {
    violet: 'from-violet-500 to-violet-600',
    blue: 'from-blue-500 to-blue-600',
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
        </div>
        <div className={`p-3 rounded-lg bg-gradient-to-br ${colors[variant]}`}>
          <Icon className="h-6 w-6 text-white" />
        </div>
      </div>
    </div>
  );
}

function EventoCard({
  evento,
  onViewQRCode,
}: {
  evento: PortalEventoDTO;
  onViewQRCode?: () => void;
}) {
  const dataInicio = new Date(evento.dataInicio);
  const isFuturo = dataInicio > new Date();

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-lg transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900">{evento.nome}</h3>
          {evento.descricao && (
            <p className="mt-1 text-sm text-gray-600 line-clamp-2">{evento.descricao}</p>
          )}
        </div>
        {evento.inscricao && (
          <span className="px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800 border border-green-200">
            Inscrito
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        {/* Data e Horário */}
        <div className="flex items-start gap-3">
          <Calendar className="h-5 w-5 text-gray-400 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-gray-900">Data</p>
            <p className="text-sm text-gray-600">
              {dataInicio.toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
              })}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {dataInicio.toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>
        </div>

        {/* Local */}
        <div className="flex items-start gap-3">
          <MapPin className="h-5 w-5 text-gray-400 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-gray-900">Local</p>
            <p className="text-sm text-gray-600">{evento.local}</p>
          </div>
        </div>

        {/* Tipo */}
        <div className="flex items-start gap-3">
          <Ticket className="h-5 w-5 text-gray-400 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-gray-900">Tipo</p>
            <p className="text-sm text-gray-600 capitalize">{evento.tipo}</p>
          </div>
        </div>

        {/* Capacidade */}
        {evento.capacidade && (
          <div className="flex items-start gap-3">
            <Users className="h-5 w-5 text-gray-400 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-gray-900">Capacidade</p>
              <p className="text-sm text-gray-600">{evento.capacidade} pessoas</p>
            </div>
          </div>
        )}
      </div>

      {/* Informações da Inscrição */}
      {evento.inscricao && (
        <div className="mt-6 p-4 bg-violet-50 border border-violet-200 rounded-lg">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-violet-900">Sua Inscrição</p>
              <p className="text-sm text-violet-800 mt-1">
                {evento.inscricao.quantidade} ingresso(s) • R$ {Number(evento.inscricao.valorTotal).toFixed(2)}
              </p>
            </div>
            {onViewQRCode && (
              <button
                onClick={onViewQRCode}
                className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors text-sm font-medium"
              >
                Ver QR Code
              </button>
            )}
          </div>
        </div>
      )}

      {/* Ação para eventos disponíveis */}
      {!evento.inscricao && evento.status === 'ATIVO' && isFuturo && (
        <div className="mt-6 pt-4 border-t border-gray-200">
          <button
            className="w-full px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors text-sm font-medium"
            disabled
          >
            Inscrever-se (em breve)
          </button>
        </div>
      )}
    </div>
  );
}

function QRCodeModal({ evento, onClose }: { evento: PortalEventoDTO; onClose: () => void }) {
  if (!evento.inscricao) return null;

  const handleDownload = () => {
    const canvas = document.getElementById('qr-code-canvas') as HTMLCanvasElement;
    if (!canvas) return;

    const url = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = url;
    link.download = `ingresso-${evento.nome.replace(/\s+/g, '-').toLowerCase()}.png`;
    link.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{evento.nome}</h2>
          <p className="text-gray-600 mb-6">Apresente este QR Code no evento</p>

          {/* QR Code */}
          <div className="bg-white p-6 rounded-xl border-2 border-gray-200 mb-6 inline-block">
            <QRCodeSVG
              id="qr-code-canvas"
              value={evento.inscricao.qrCode}
              size={256}
              level="H"
              includeMargin
            />
          </div>

          {/* Informações */}
          <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left">
            <div className="flex items-center gap-3 mb-3">
              <Calendar className="h-5 w-5 text-gray-600" />
              <p className="text-sm text-gray-900">
                {new Date(evento.dataInicio).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
            <div className="flex items-center gap-3 mb-3">
              <MapPin className="h-5 w-5 text-gray-600" />
              <p className="text-sm text-gray-900">{evento.local}</p>
            </div>
            <div className="flex items-center gap-3">
              <Ticket className="h-5 w-5 text-gray-600" />
              <p className="text-sm text-gray-900">
                {evento.inscricao.quantidade} ingresso(s)
              </p>
            </div>
          </div>

          {/* Ações */}
          <div className="flex gap-3">
            <button
              onClick={handleDownload}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors font-medium"
            >
              <Download className="h-5 w-5" />
              Baixar QR Code
            </button>
            <button
              onClick={onClose}
              className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

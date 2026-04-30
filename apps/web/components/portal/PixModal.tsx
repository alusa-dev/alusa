'use client';

import { useState } from 'react';
import { X, Copy, CheckCircle } from '@/components/icons/icons';
import { QrCodeIcon } from '@heroicons/react/24/outline';
import Image from 'next/image';

interface PixModalProps {
  open: boolean;
  onClose: () => void;
  pixData: {
    encodedImage: string;
    payload: string;
    expirationDate: string;
  } | null;
}

export function PixModal({ open, onClose, pixData }: PixModalProps) {
  const [copied, setCopied] = useState(false);

  if (!open || !pixData) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(pixData.payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Erro ao copiar:', error);
    }
  };

  const expirationDate = new Date(pixData.expirationDate);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-violet-600 to-purple-600 p-6 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-lg">
                <QrCodeIcon className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold">Pagamento PIX</h2>
                <p className="text-sm text-white/90">Escaneie o QR Code ou copie o código</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              aria-label="Fechar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          {/* QR Code */}
          <div className="flex flex-col items-center">
            <div className="bg-white border-4 border-violet-100 rounded-2xl p-4 shadow-lg">
              <div className="relative w-64 h-64">
                <Image
                  src={`data:image/png;base64,${pixData.encodedImage}`}
                  alt="QR Code PIX"
                  fill
                  className="object-contain"
                />
              </div>
            </div>
            <p className="mt-4 text-sm text-gray-600 text-center">
              Aponte a câmera do seu celular para o QR Code
            </p>
          </div>

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-white text-gray-500">ou copie o código</span>
            </div>
          </div>

          {/* Código PIX */}
          <div className="space-y-3">
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <p className="text-xs font-mono text-gray-600 break-all leading-relaxed">
                {pixData.payload}
              </p>
            </div>
            <button
              onClick={handleCopy}
              className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-all ${
                copied
                  ? 'bg-green-50 text-green-700 border-2 border-green-200'
                  : 'bg-violet-600 text-white hover:bg-violet-700'
              }`}
            >
              {copied ? (
                <>
                  <CheckCircle className="h-5 w-5" />
                  Código Copiado!
                </>
              ) : (
                <>
                  <Copy className="h-5 w-5" />
                  Copiar Código PIX
                </>
              )}
            </button>
          </div>

          {/* Expiration Info */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <p className="text-sm text-amber-800">
              <span className="font-medium">Válido até: </span>
              {expirationDate.toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 border-t border-gray-200">
          <p className="text-xs text-gray-600 text-center">
            Após o pagamento, pode levar alguns minutos para a confirmação aparecer.
          </p>
        </div>
      </div>
    </div>
  );
}


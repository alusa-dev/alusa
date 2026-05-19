import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { InfoCallout } from '@/components/ui/info-callout';

interface CardDetailsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CardDetailsDrawer({ isOpen, onClose }: CardDetailsDrawerProps) {
  const [cardHolder, setCardHolder] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');

  // Reset fields when drawer closes
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setCardHolder('');
        setCardNumber('');
        setCardExpiry('');
        setCardCvv('');
      }, 300); // Wait for animation
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="w-full md:w-96 md:max-w-md bg-white border-t md:border-t-0 md:border-l border-gray-200 shadow-xl flex flex-col">
      {/* Header */}
      <div className="relative border-b border-gray-200 bg-gradient-to-r from-violet-50 to-violet-100/50 p-6">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-2 text-violet-600 hover:bg-violet-200/50 transition"
          aria-label="Fechar detalhes do cartão"
        >
          <XMarkIcon className="h-5 w-5" />
        </button>
        <h3 className="text-lg font-semibold text-violet-900">Detalhes do cartão</h3>
        <p className="mt-1 text-sm text-violet-700">
          Use o cartão do responsável financeiro para autorizar a cobrança recorrente.
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-6">
          {/* Card Preview */}
          <div className="rounded-xl bg-gradient-to-br from-violet-600 to-violet-800 p-6 text-white shadow-lg">
            <div className="mb-8">
              <div className="text-xs font-medium uppercase tracking-wider opacity-80">
                Cartão de Crédito
              </div>
            </div>
            <div className="mb-6">
              <div className="font-mono text-lg tracking-wider">
                {cardNumber || '•••• •••• •••• ••••'}
              </div>
            </div>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-xs opacity-80">Titular</div>
                <div className="text-sm font-medium">{cardHolder || 'NOME DO TITULAR'}</div>
              </div>
              <div className="text-right">
                <div className="text-xs opacity-80">Validade</div>
                <div className="text-sm font-medium">{cardExpiry || 'MM/AA'}</div>
              </div>
            </div>
          </div>

          {/* Form Fields */}
          <div className="space-y-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-gray-700">Nome impresso no cartão</label>
              <Input
                value={cardHolder}
                onChange={(e) => setCardHolder(e.target.value.toUpperCase())}
                placeholder="MARIA DA SILVA"
                className="h-11 rounded-lg border-gray-300 text-sm text-gray-900 placeholder:text-gray-400"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-gray-700">Número do cartão</label>
              <Input
                value={cardNumber}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, '');
                  const formatted = value
                    .replace(/(\d{4})/g, '$1 ')
                    .trim()
                    .slice(0, 19);
                  setCardNumber(formatted);
                }}
                placeholder="0000 0000 0000 0000"
                maxLength={19}
                className="h-11 rounded-lg border-gray-300 font-mono text-sm text-gray-900 placeholder:text-gray-400"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-gray-700">Validade</label>
                <Input
                  value={cardExpiry}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '');
                    const formatted = value.replace(/(\d{2})(\d{0,2})/, '$1/$2').slice(0, 5);
                    setCardExpiry(formatted);
                  }}
                  placeholder="MM/AA"
                  maxLength={5}
                  className="h-11 rounded-lg border-gray-300 font-mono text-sm text-gray-900 placeholder:text-gray-400"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-gray-700">CVV</label>
                <Input
                  value={cardCvv}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '').slice(0, 4);
                    setCardCvv(value);
                  }}
                  placeholder="123"
                  maxLength={4}
                  type="password"
                  className="h-11 rounded-lg border-gray-300 font-mono text-sm text-gray-900 placeholder:text-gray-400"
                />
              </div>
            </div>
          </div>

          <InfoCallout showIcon>
            <p className="font-medium text-slate-800">Pagamento seguro</p>
            <p className="mt-1 text-xs text-slate-600">
              Seus dados são criptografados e protegidos de acordo com os padrões PCI DSS.
            </p>
          </InfoCallout>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-gray-200 bg-gray-50 p-6">
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-lg bg-violet-600 px-4 py-3 text-sm font-medium text-white hover:bg-violet-700 transition"
        >
          Confirmar dados do cartão
        </button>
      </div>
    </div>
  );
}

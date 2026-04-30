'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from '@/components/icons/icons';
import { cn } from '@/lib/cn';
import { listProductVariants, type ProductVariantDTO } from '../services/product-variant-service';

interface Props {
  open: boolean;
  productId: string;
  productName: string;
  defaultPrice: number;
  onConfirm: (_variant: ProductVariantDTO) => void;
  onClose: () => void;
}

export function VariantSelectorModal({
  open,
  productId,
  productName,
  defaultPrice,
  onConfirm,
  onClose,
}: Props) {
  const [variants, setVariants] = useState<ProductVariantDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSelected(null);
      setError(null);
      return;
    }
    setLoading(true);
    void listProductVariants(productId)
      .then((v) => setVariants(v.filter((x) => x.isActive)))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open, productId]);

  function handleConfirm() {
    const variant = variants.find((v) => v.id === selected);
    if (!variant) return;
    onConfirm(variant);
    onClose();
  }

  const selectedVariant = variants.find((v) => v.id === selected);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-full max-w-sm overflow-hidden p-0">
        <div className="border-b border-slate-200 px-5 py-4">
          <DialogTitle className="text-base font-semibold text-slate-900">
            Selecionar variante
          </DialogTitle>
          <DialogDescription className="mt-0.5 text-sm text-slate-500">
            {productName}
          </DialogDescription>
        </div>

        <div className="px-5 py-4 space-y-2 max-h-64 overflow-y-auto">
          {loading && (
            <div className="flex justify-center py-6">
              <Loader2 className="size-5 animate-spin text-slate-400" />
            </div>
          )}
          {error && (
            <p className="text-xs font-medium text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          {!loading &&
            !error &&
            variants.map((variant) => {
              const outOfStock = variant.available <= 0;
              const isSelected = selected === variant.id;
              const effectivePrice = variant.price ?? defaultPrice;
              return (
                <button
                  key={variant.id}
                  type="button"
                  disabled={outOfStock}
                  onClick={() => setSelected(variant.id)}
                  className={cn(
                    'w-full flex items-center justify-between rounded-xl border px-4 py-3 text-left transition',
                    isSelected
                      ? 'border-[#A94DFF] bg-[#A94DFF]/5 ring-1 ring-[#A94DFF]'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                    outOfStock && 'opacity-40 cursor-not-allowed',
                  )}
                >
                  <span>
                    <span className="block text-sm font-medium text-slate-800">
                      {variant.title}
                    </span>
                    <span className="block text-xs text-slate-500 mt-0.5">
                      {variant.sku ? `SKU ${variant.sku} · ` : ''}
                      Disponível: {variant.available}
                    </span>
                  </span>
                  <span className="text-sm font-semibold text-slate-900">
                    R$ {Number(effectivePrice).toFixed(2).replace('.', ',')}
                  </span>
                </button>
              );
            })}
          {!loading && !error && variants.length === 0 && (
            <p className="text-center text-sm text-slate-400 py-4">Nenhuma variante disponível.</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-5 py-4">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            size="sm"
            disabled={!selected}
            onClick={handleConfirm}
            className="bg-[#A94DFF] hover:bg-[#8E2DE2] text-white"
          >
            Adicionar
            {selectedVariant
              ? ` · R$ ${Number(selectedVariant.price ?? defaultPrice)
                  .toFixed(2)
                  .replace('.', ',')}`
              : ''}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

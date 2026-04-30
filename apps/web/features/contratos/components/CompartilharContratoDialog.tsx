
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { DocumentDuplicateIcon } from '@heroicons/react/24/outline';
import { toast } from '@/components/ui/toast';

interface CompartilharContratoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tokenPublico: string;
  alunoNome: string;
}

export function CompartilharContratoDialog({
  open,
  onOpenChange,
  tokenPublico,
  alunoNome,
}: CompartilharContratoDialogProps) {
  const link = typeof window !== 'undefined' ? `${window.location.origin}/p/contrato/${tokenPublico}` : '';

  const handleCopy = () => {
    navigator.clipboard.writeText(link);
    toast.success('Link copiado para a área de transferência');
  };

  const handleWhatsApp = () => {
    const text = `Olá! Segue o link para assinatura do contrato da matrícula de ${alunoNome}: ${link}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Compartilhar Contrato</DialogTitle>
          <DialogDescription>
            Envie este link para o responsável ou aluno realizar a assinatura eletrônica.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Link de Assinatura</Label>
            <div className="flex items-center space-x-2">
              <Input value={link} readOnly />
              <Button size="icon" variant="outline" onClick={handleCopy} title="Copiar">
                <DocumentDuplicateIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="pt-2">
            <Button className="w-full bg-green-600 hover:bg-green-700 text-white" onClick={handleWhatsApp}>
              Enviar por WhatsApp
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

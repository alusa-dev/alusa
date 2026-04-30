
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useModelos } from '../hooks/use-modelos';
import { createContrato } from '../services/modelos-service';
import { toast } from '@/components/ui/toast';

interface GerarContratoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  matriculaId: string;
  alunoNome: string;
}

export function GerarContratoDialog({
  open,
  onOpenChange,
  matriculaId,
  alunoNome,
}: GerarContratoDialogProps) {
  const { modelos, loading: loadingModelos } = useModelos({ activeOnly: true });
  const [selectedModelo, setSelectedModelo] = useState<string>('');
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    if (!selectedModelo) {
      toast.error('Selecione um modelo de contrato');
      return;
    }

    try {
      setGenerating(true);
      await createContrato({
        modeloId: selectedModelo,
        matriculaId,
      });
      toast.success('Contrato gerado com sucesso');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao gerar contrato');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Gerar Contrato</DialogTitle>
          <DialogDescription>
            Selecione o modelo para gerar o contrato de <b>{alunoNome}</b>.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <div className="space-y-2">
            <Label>Modelo de Contrato</Label>
            <Select value={selectedModelo} onValueChange={setSelectedModelo} disabled={loadingModelos}>
              <SelectTrigger>
                <SelectValue placeholder={loadingModelos ? "Carregando modelos..." : "Selecione um modelo"} />
              </SelectTrigger>
              <SelectContent>
                {modelos.map((modelo) => (
                  <SelectItem key={modelo.id} value={modelo.id}>
                    {modelo.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {modelos.length === 0 && !loadingModelos && (
              <p className="text-xs text-yellow-600">
                Nenhum modelo ativo encontrado. Importe um PDF em Contratos {'>'} Modelos.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button 
            onClick={handleGenerate} 
            disabled={generating || !selectedModelo}
            className="bg-brand-accent hover:bg-brand-accent/90 text-white"
          >
            {generating ? 'Gerando...' : 'Gerar Contrato'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

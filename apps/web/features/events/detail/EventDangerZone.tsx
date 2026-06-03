'use client';

import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';

import { type SchoolEventDTO } from '../events-service';
import { eventQueryKeys } from '../shared/event-query-keys';

export function EventDangerZone({ event }: { event: SchoolEventDTO }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: () =>
      fetch('/api/events/' + event.id, { method: 'DELETE' }).then(async (res) => {
        if (!res.ok) {
          const json = await res.json();
          throw new Error(json.error?.message || 'Erro ao deletar evento');
        }
        return res.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.events });
      toast.success({ title: 'Evento excluído', description: 'O evento foi removido com sucesso.' });
      router.push('/events');
    },
    onError: (error) => {
      toast.error({ title: 'Erro ao excluir evento', description: error.message });
    },
  });

  return (
    <Card className="rounded-xl border border-rose-200 bg-rose-50/10 p-5 shadow-sm mt-8">
      <CardHeader className="p-0 pb-4">
        <CardTitle className="text-base font-semibold text-rose-800">Zona de Perigo</CardTitle>
        <p className="text-xs text-rose-600 mt-1">
          Excluir permanentemente este evento e todos os seus dados associados (ingressos, figurinos, participantes e registros de caixa). Esta ação não pode ser desfeita.
        </p>
      </CardHeader>
      <CardContent className="p-0 pt-2">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="destructive" className="bg-rose-600 hover:bg-rose-700 text-white font-medium">
              Excluir Evento
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-rose-800">Excluir Evento</DialogTitle>
              <DialogDescription>
                Você tem certeza que deseja excluir o evento <strong>{event.name}</strong>? Todos os dados associados a este evento serão permanentemente perdidos.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <DialogClose asChild>
                <Button variant="outline">Cancelar</Button>
              </DialogClose>
              <Button
                variant="destructive"
                className="bg-rose-600 hover:bg-rose-700 text-white"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? 'Excluindo...' : 'Confirmar Exclusão'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

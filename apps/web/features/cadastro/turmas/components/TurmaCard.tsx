import type { TurmaListItem } from '../services/turmas-service';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { UsersIcon, ClockIcon, CalendarIcon } from '@heroicons/react/24/outline';
import { cn } from '@/lib/cn';

interface TurmaCardProps {
  turma: TurmaListItem;
  onClick: () => void;
}

export function TurmaCard({ turma, onClick }: TurmaCardProps) {
  const ocupacao = turma.capacidade > 0 ? (turma.vagasOcupadas / turma.capacidade) * 100 : 0;
  const isFull = turma.vagasOcupadas >= turma.capacidade;

  return (
    <Card 
      className="cursor-pointer transition-shadow hover:shadow-md"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start">
          <CardTitle className="text-lg font-semibold text-gray-800 line-clamp-1" title={turma.nome}>
            {turma.nome}
          </CardTitle>
          <Badge status={turma.status === 'ATIVO' ? 'ATIVA' : 'INATIVA'} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 text-sm text-gray-600">
          <div className="flex items-center gap-2">
            <ClockIcon className="h-4 w-4" />
            <span>{turma.horaInicio} - {turma.horaFim}</span>
          </div>
          <div className="flex items-center gap-2">
            <CalendarIcon className="h-4 w-4" />
            <span className="capitalize">{turma.diasSemana.join(', ').toLowerCase()}</span>
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <UsersIcon className="h-3 w-3" />
              Ocupação
            </span>
            <span className={cn(isFull && "text-red-600 font-medium")}>
              {turma.vagasOcupadas} / {turma.capacidade}
            </span>
          </div>
          <Progress value={ocupacao} className={cn("h-2", isFull ? "bg-red-100" : "bg-gray-100")} indicatorClassName={cn(isFull ? "bg-red-500" : "bg-brand-primary")} />
        </div>
      </CardContent>
    </Card>
  );
}

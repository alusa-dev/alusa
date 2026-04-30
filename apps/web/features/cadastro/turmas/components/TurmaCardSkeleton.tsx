import { Card, CardContent, CardHeader } from '@/components/ui/card';

export function TurmaCardSkeleton() {
  return (
    <Card className="animate-pulse">
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start">
          {/* Título */}
          <div className="h-5 w-32 bg-gray-200 rounded" />
          {/* Badge */}
          <div className="h-5 w-12 bg-gray-200 rounded-full" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {/* Horário */}
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 bg-gray-200 rounded" />
            <div className="h-4 w-24 bg-gray-200 rounded" />
          </div>
          {/* Dias */}
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 bg-gray-200 rounded" />
            <div className="h-4 w-20 bg-gray-200 rounded" />
          </div>
        </div>

        <div className="space-y-1">
          {/* Ocupação label */}
          <div className="flex justify-between">
            <div className="h-3 w-16 bg-gray-200 rounded" />
            <div className="h-3 w-10 bg-gray-200 rounded" />
          </div>
          {/* Progress bar */}
          <div className="h-2 w-full bg-gray-200 rounded-full" />
        </div>
      </CardContent>
    </Card>
  );
}

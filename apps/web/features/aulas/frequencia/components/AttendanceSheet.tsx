'use client';

import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import type { AttendanceStatusDTO } from '@/features/aulas/dtos';
import {
  getAttendanceEvent,
  saveAttendanceEvent,
} from '@/features/aulas/frequencia/services/attendance-service';
import { ATTENDANCE_STATUS_OPTIONS } from '@/features/aulas/types';
import { cn } from '@/lib/utils';

type AttendanceSheetProps = {
  open: boolean;
  eventId: string | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

type DraftRecord = {
  alunoId: string;
  matriculaId: string | null;
  nome: string;
  source: 'TURMA' | 'REPOSICAO';
  status: AttendanceStatusDTO | null;
  observacao: string;
};

export function AttendanceSheet({
  open,
  eventId,
  onOpenChange,
  onSaved,
}: AttendanceSheetProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('Chamada');
  const [records, setRecords] = useState<DraftRecord[]>([]);

  useEffect(() => {
    if (!open || !eventId) {
      setRecords([]);
      setError(null);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await getAttendanceEvent(eventId);
        if (cancelled) return;

        setTitle(result.data.event.title);
        setRecords(
          result.data.students.map((student) => ({
            alunoId: student.alunoId,
            matriculaId: student.matriculaId,
            nome: student.nome,
            source: student.source,
            status: student.status,
            observacao: student.observacao ?? '',
          })),
        );
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [eventId, open]);

  async function handleSave() {
    if (!eventId) return;

    try {
      setSaving(true);
      setError(null);
      await saveAttendanceEvent(eventId, {
        items: records
          .filter((record) => record.status)
          .map((record) => ({
            alunoId: record.alunoId,
            matriculaId: record.matriculaId,
            status: record.status as AttendanceStatusDTO,
            observacao: record.observacao.trim() || null,
          })),
      });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            Registre presença na ocorrência real da aula, sem duplicar regra na turma.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-6 py-6">
          {loading ? <div className="text-sm text-slate-500">Carregando chamada...</div> : null}
          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          {records.map((record) => (
            <div key={record.alunoId} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold text-slate-900">{record.nome}</div>
                    {record.source === 'REPOSICAO' ? <Badge variant="info">Reposição</Badge> : null}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {record.matriculaId ? `Matrícula ${record.matriculaId.slice(0, 8)}` : 'Sem matrícula vinculada'}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {ATTENDANCE_STATUS_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() =>
                        setRecords((current) =>
                          current.map((item) =>
                            item.alunoId === record.alunoId ? { ...item, status: option.value } : item,
                          ),
                        )
                      }
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                        record.status === option.value
                          ? 'border-brand-accent bg-brand-accent text-white'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900',
                      )}
                      data-testid={`attendance-status-${record.alunoId}-${option.value}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <Textarea
                value={record.observacao}
                onChange={(event) =>
                  setRecords((current) =>
                    current.map((item) =>
                      item.alunoId === record.alunoId
                        ? { ...item, observacao: event.target.value }
                        : item,
                    ),
                  )
                }
                className="mt-3 min-h-[84px] rounded-2xl border-slate-200"
                placeholder="Observação opcional"
              />
            </div>
          ))}
        </div>

        <SheetFooter>
          <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button className="rounded-xl bg-brand-accent text-white hover:bg-brand-accent/90" onClick={handleSave} disabled={saving} data-testid="attendance-save">
            {saving ? 'Salvando...' : 'Salvar chamada'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

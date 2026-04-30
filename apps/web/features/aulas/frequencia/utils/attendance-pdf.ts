import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

import type { AttendanceEventDetailsResultDTO, AttendanceStatusDTO } from '@/features/aulas/dtos';

const STATUS_LABELS: Record<AttendanceStatusDTO, string> = {
  PRESENTE: 'Presente',
  FALTA: 'Falta',
  FALTA_JUSTIFICADA: 'Falta justificada',
  ATRASO: 'Atraso',
  REPOSICAO: 'Reposição',
};

function sanitizeFileName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

export function downloadAttendancePdf(result: AttendanceEventDetailsResultDTO) {
  const { event, students, summary } = result.data;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const title = event.turma?.label ?? event.title;
  const occurrenceDate = format(new Date(event.startAt), "dd/MM/yyyy 'às' HH:mm", {
    locale: ptBR,
  });
  const professors = event.professores.map((professor) => professor.nome).join(', ') || 'Sem professor';
  const room = event.sala?.label ?? 'Sem sala';

  doc.setFontSize(18);
  doc.text('Relatório de frequência', 40, 52);
  doc.setFontSize(11);
  doc.text(`Turma: ${title}`, 40, 78);
  doc.text(`Ocorrência: ${event.title}`, 40, 96);
  doc.text(`Data: ${occurrenceDate}`, 40, 114);
  doc.text(`Professor(es): ${professors}`, 40, 132);
  doc.text(`Sala: ${room}`, 40, 150);

  doc.setFontSize(10);
  doc.text(
    `Resumo: ${summary.recorded} lançamentos | ${summary.presente} presentes | ${summary.falta} faltas | ${summary.faltaJustificada} justificadas | ${summary.atraso} atrasos | ${summary.reposicao} reposições`,
    40,
    176,
  );

  autoTable(doc, {
    startY: 196,
    head: [['Aluno', 'Origem', 'Status', 'Observação']],
    body: students.map((student) => [
      student.nome,
      student.source === 'REPOSICAO' ? 'Reposição' : 'Turma',
      student.status ? STATUS_LABELS[student.status] : 'Não lançado',
      student.observacao?.trim() || '-',
    ]),
    styles: {
      fontSize: 9,
      cellPadding: 6,
      valign: 'middle',
    },
    headStyles: {
      fillColor: [88, 59, 154],
    },
    margin: { left: 40, right: 40 },
  });

  doc.save(
    `${sanitizeFileName(title || event.title)}-${format(new Date(event.startAt), 'yyyy-MM-dd')}.pdf`,
  );
}
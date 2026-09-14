import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { SelectField } from '@/components/forms/SelectField';
import { PageHeader } from '@/components/layout/PageHeader';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/primitives/Button';
import { AppText } from '@/components/primitives/AppText';
import { agendaService } from '@/features/agenda/services/agenda-service';
import type { AttendanceResponse, AttendanceStatus } from '@/features/agenda/types/agenda';
import { colors, radius, spacing } from '@/theme/tokens';

const statusOptions: Array<{ value: AttendanceStatus; label: string }> = [
  { value: 'PRESENTE', label: 'Presente' },
  { value: 'FALTA', label: 'Falta' },
  { value: 'FALTA_JUSTIFICADA', label: 'Falta justificada' },
  { value: 'ATRASO', label: 'Atraso' },
  { value: 'REPOSICAO', label: 'Reposição' },
];

export default function AgendaAttendanceScreen() {
  const { eventId } = useLocalSearchParams<{ eventId?: string }>();
  const normalizedEventId = typeof eventId === 'string' ? eventId : '';
  const [data, setData] = useState<AttendanceResponse | null>(null);
  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus | null>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!normalizedEventId) {
      setLoading(false);
      setError('Não foi possível identificar a aula.');
      return;
    }

    let active = true;
    setLoading(true);
    void agendaService.getAttendance(normalizedEventId)
      .then((result) => {
        if (!active) return;
        setData(result);
        setStatuses(Object.fromEntries(result.data.students.map((student) => [student.alunoId, student.status])));
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a frequência.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [normalizedEventId]);

  const pendingStudents = useMemo(
    () => data?.data.students.filter((student) => !statuses[student.alunoId]).length ?? 0,
    [data, statuses],
  );

  async function save() {
    if (!data || !normalizedEventId) return;
    if (pendingStudents > 0) {
      setError('Informe a situação de todos os alunos antes de salvar.');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      await agendaService.saveAttendance(normalizedEventId, data.data.students.map((student) => ({
        alunoId: student.alunoId,
        matriculaId: student.matriculaId,
        status: statuses[student.alunoId] as AttendanceStatus,
        observacao: student.observacao,
      })));
      Alert.alert('Frequência salva', 'Os registros foram atualizados com sucesso.');
      router.back();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar a frequência.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen scroll backgroundColor={colors.surface} style={styles.screen}>
      <PageHeader title="Frequência" onBack={() => router.back()} />
      {loading ? <View style={styles.loading}><AppText tone="muted">Carregando alunos...</AppText></View> : error && !data ? <ErrorState title="Não foi possível carregar a frequência" message={error} actionLabel="Voltar" onAction={() => router.back()} /> : data ? (
        <View style={styles.content}>
          <View style={styles.introduction}>
            <AppText variant="subheading" weight="medium" numberOfLines={2}>{data.data.event.title}</AppText>
            <AppText variant="small" tone="muted">Registre a situação de cada aluno para concluir a aula.</AppText>
          </View>

          <View style={styles.summaryCard}>
            <AppText variant="small" tone="muted">Registros preenchidos</AppText>
            <AppText variant="heading" weight="medium">{data.data.students.length - pendingStudents} de {data.data.students.length}</AppText>
          </View>

          {data.data.students.length > 0 ? (
            <View style={styles.studentList}>
              {data.data.students.map((student) => (
                <View key={student.alunoId} style={styles.studentRow}>
                  <View style={styles.studentCopy}><AppText weight="medium" numberOfLines={1}>{student.nome}</AppText><AppText variant="tiny" tone="muted">{student.source === 'REPOSICAO' ? 'Reposição' : 'Aluno da turma'}</AppText></View>
                  <View style={styles.statusSelect}><SelectField label="Situação" value={statusOptions.find((item) => item.value === statuses[student.alunoId])?.label ?? 'Selecionar'} selectedValue={statuses[student.alunoId] ?? ''} options={[{ value: '', label: 'Selecionar' }, ...statusOptions]} onValueChange={(value) => setStatuses((current) => ({ ...current, [student.alunoId]: (value || null) as AttendanceStatus | null }))} /></View>
                </View>
              ))}
            </View>
          ) : <EmptyState title="Nenhum aluno elegível" message="Esta ocorrência não possui alunos para registrar." variant="neutral" />}

          {error ? <View style={styles.errorBox}><AppText variant="small" tone="danger">{error}</AppText></View> : null}
          {data.data.students.length > 0 ? <Button title="Salvar frequência" loading={saving} onPress={() => void save()} /> : null}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { gap: spacing.lg, paddingBottom: spacing['2xl'] },
  content: { gap: spacing.lg },
  introduction: { gap: spacing.xs },
  loading: { minHeight: 260, alignItems: 'center', justifyContent: 'center' },
  summaryCard: { gap: spacing.xs, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.brandSoft },
  studentList: { gap: spacing.md },
  studentRow: { gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  studentCopy: { gap: spacing.xs },
  statusSelect: { flex: 1 },
  errorBox: { padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
});

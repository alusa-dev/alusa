import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronRightIcon } from 'react-native-heroicons/outline';

import { InlineSearchHeader } from '@/components/layout/InlineSearchHeader';
import { Screen } from '@/components/layout/Screen';
import { AppText } from '@/components/primitives/AppText';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { enrollmentService } from '@/features/enrollments/services/enrollment-service';
import { StudentAvatar } from '@/features/students/components/StudentAvatar';
import type { EnrollmentClassDetailResponse } from '@/features/enrollments/types/enrollment';
import { colors, radius, spacing } from '@/theme/tokens';

export default function EnrollmentClassScreen() {
  const { classId } = useLocalSearchParams<{ classId?: string }>();
  const resolvedClassId = Array.isArray(classId) ? classId[0] : classId;
  const [classDetail, setClassDetail] = useState<EnrollmentClassDetailResponse['class'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const loadClass = useCallback(async () => {
    if (!resolvedClassId) {
      setError('Turma inválida.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await enrollmentService.getClass(resolvedClassId);
      setClassDetail(response.class);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar a turma.');
    } finally {
      setLoading(false);
    }
  }, [resolvedClassId]);

  useEffect(() => {
    void loadClass();
  }, [loadClass]);

  const goBack = () => router.back();
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const students = useMemo(
    () => classDetail?.students.filter((student) => student.name.toLocaleLowerCase().includes(normalizedSearch)) ?? [],
    [classDetail?.students, normalizedSearch],
  );

  return (
    <Screen scroll keyboard backgroundColor={colors.surface} style={styles.screen}>
      <InlineSearchHeader
        title={classDetail?.name ?? 'Turma'}
        search={search}
        onSearchChange={setSearch}
        placeholder="Pesquisar aluno"
        accessibilityLabel="Pesquisar aluno"
        onBack={goBack}
      />

      {loading ? <EnrollmentClassSkeleton /> : null}
      {!loading && error ? <ErrorState title="Não foi possível carregar" message={error} actionLabel="Voltar para turmas" onAction={goBack} /> : null}
      {!loading && !error && classDetail ? (
        <>
          <View style={styles.sectionHeader}>
            <AppText variant="subheading" weight="medium">Alunos matriculados</AppText>
            <AppText tone="muted">{classDetail.students.length}</AppText>
          </View>

          {classDetail.students.length === 0 ? <EmptyState title="Nenhum aluno matriculado" message="Esta turma ainda não possui matrículas ocupando vaga." /> : null}
          {classDetail.students.length > 0 && students.length === 0 ? <EmptyState variant="neutral" title="Nenhum aluno encontrado" message="Revise o nome pesquisado e tente novamente." /> : null}
          <View style={styles.studentList}>
            {students.map((student) => (
              <Pressable
                key={student.id}
                accessibilityRole="button"
                accessibilityLabel={`Abrir detalhes de ${student.name}`}
                onPress={() => router.push({ pathname: '/(app)/enrollments/detail/[enrollmentId]', params: { enrollmentId: student.enrollmentId } })}
                style={({ pressed }) => [styles.studentRow, pressed ? styles.pressed : null]}
              >
                <StudentAvatar name={student.name} photo={student.photo} />
                <AppText variant="body" weight="medium" numberOfLines={1} style={styles.studentName}>{student.name}</AppText>
                <ChevronRightIcon color={colors.inkMuted} size={20} strokeWidth={1.8} />
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

function EnrollmentClassSkeleton() {
  return (
    <View style={skeletonStyles.content} accessibilityLabel="Carregando turma">
      <View style={skeletonStyles.sectionHeader}><Skeleton width="56%" height={24} /><Skeleton width={28} height={18} /></View>
      {[0, 1, 2, 3].map((item) => <View key={item} style={skeletonStyles.student}><Skeleton width={40} height={40} radius={radius.pill} /><Skeleton width={`${62 + (item % 2) * 12}%`} height={18} /></View>)}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { gap: spacing.xl, paddingBottom: spacing['2xl'] },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  studentList: { gap: spacing.sm },
  studentRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingRight: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  studentName: { flex: 1 },
  pressed: { opacity: 0.78 },
});

const skeletonStyles = StyleSheet.create({
  content: { gap: spacing.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  student: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
});

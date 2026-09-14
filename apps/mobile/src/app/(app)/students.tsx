import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { ChevronRightIcon } from 'react-native-heroicons/outline';

import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { InlineSearchHeader } from '@/components/layout/InlineSearchHeader';
import { Screen } from '@/components/layout/Screen';
import { AppText } from '@/components/primitives/AppText';
import { StudentAvatar } from '@/features/students/components/StudentAvatar';
import { StudentFilterSheet, type StudentStatusFilter } from '@/features/students/components/StudentFilterSheet';
import { studentService } from '@/features/students/services/student-service';
import type { Student } from '@/features/students/types/student';
import { colors, radius, spacing } from '@/theme/tokens';

export default function StudentsScreen() {
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StudentStatusFilter>('ALL');
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStudents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await studentService.listStudents();
      setStudents(response.students);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os alunos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStudents();
  }, [loadStudents]);

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredStudents = useMemo(
    () => students.filter((student) => {
      const matchesSearch = student.name.toLocaleLowerCase().includes(normalizedSearch);
      const matchesStatus = statusFilter === 'ALL' || (statusFilter === 'ACTIVE' ? student.status.toUpperCase() === 'ATIVO' : student.status.toUpperCase() !== 'ATIVO');
      return matchesSearch && matchesStatus;
    }),
    [students, normalizedSearch, statusFilter],
  );

  return (
    <Screen scroll keyboard backgroundColor={colors.surface} style={styles.screen}>
      <InlineSearchHeader
        title="Alunos"
        search={search}
        onSearchChange={setSearch}
        placeholder="Procurar pelo nome"
        accessibilityLabel="Pesquisar alunos"
        onBack={() => router.back()}
        onFilterPress={() => setFilterOpen(true)}
        filterActive={statusFilter !== 'ALL'}
      />

      <View style={styles.list}>
        {loading ? <StudentsSkeleton /> : null}
        {!loading && error ? <ErrorState title="Não foi possível carregar" message={error} actionLabel="Tentar novamente" onAction={() => void loadStudents()} /> : null}
        {!loading && !error && students.length === 0 ? <EmptyState title="Nenhum aluno cadastrado" message="Os alunos da conta aparecerão aqui quando forem cadastrados." /> : null}
        {!loading && !error && students.length > 0 && filteredStudents.length === 0 ? <EmptyState variant="neutral" title="Nenhum aluno encontrado" message="Revise o nome pesquisado e tente novamente." /> : null}
        {!loading && !error ? filteredStudents.map((student) => <StudentCard key={student.id} student={student} />) : null}
      </View>
      <StudentFilterSheet visible={filterOpen} value={statusFilter} onChange={setStatusFilter} onClose={() => setFilterOpen(false)} />
    </Screen>
  );
}

function StudentsSkeleton() {
  return (
    <View style={skeletonStyles.list} accessibilityLabel="Carregando alunos">
      {[0, 1, 2, 3, 4].map((item) => (
        <View key={item} style={skeletonStyles.card}><Skeleton width={40} height={40} radius={radius.pill} /><Skeleton width={`${58 + (item % 3) * 8}%`} height={18} /></View>
      ))}
    </View>
  );
}

function StudentCard({ student }: { student: Student }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Abrir detalhes de ${student.name}`}
      onPress={() => router.push({ pathname: '/(app)/students/[studentId]', params: { studentId: student.id } })}
      style={({ pressed }) => [styles.studentCard, pressed ? styles.pressed : null]}
    >
      <StudentAvatar name={student.name} photo={student.photo} />
      <AppText variant="body" weight="medium" numberOfLines={1} style={styles.studentName}>{student.name}</AppText>
      <ChevronRightIcon color={colors.inkMuted} size={20} strokeWidth={1.8} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { gap: spacing.xl, paddingBottom: spacing['2xl'] },
  list: { gap: spacing.sm },
  studentCard: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  studentName: { flex: 1 },
  pressed: { opacity: 0.76 },
});

const skeletonStyles = StyleSheet.create({
  list: { gap: spacing.sm },
  card: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
});

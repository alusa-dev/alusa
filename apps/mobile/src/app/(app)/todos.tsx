import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import {
  AcademicCapIcon,
  ArrowPathIcon,
  BanknotesIcon,
  BellIcon,
  CalendarDaysIcon,
  ClipboardDocumentListIcon,
  CreditCardIcon,
  DocumentChartBarIcon,
  DocumentTextIcon,
  QrCodeIcon,
  UserGroupIcon,
  UserIcon,
} from 'react-native-heroicons/outline';

import { Screen } from '@/components/layout/Screen';
import { SearchField } from '@/components/forms/SearchField';
import { AppText } from '@/components/primitives/AppText';
import { colors, radius, spacing } from '@/theme/tokens';

const sections = [
  {
    title: 'Gestão escolar',
    items: [
      { title: 'Alunos', icon: UserGroupIcon },
      { title: 'Responsáveis', icon: UserIcon },
      { title: 'Turmas', icon: AcademicCapIcon },
      { title: 'Matrículas', icon: ClipboardDocumentListIcon },
    ],
  },
  {
    title: 'Cobrança',
    items: [
      { title: 'Todas as cobranças', icon: BanknotesIcon },
      { title: 'Avulsas', icon: CreditCardIcon },
      { title: 'Parcelamentos', icon: DocumentTextIcon },
      { title: 'Assinaturas', icon: ArrowPathIcon },
      { title: 'Relatório', icon: DocumentChartBarIcon },
    ],
  },
  {
    title: 'Eventos',
    items: [
      { title: 'Ler ingresso', icon: QrCodeIcon },
      { title: 'Eventos', icon: CalendarDaysIcon },
    ],
  },
  {
    title: 'Comunicação',
    items: [
      { title: 'Agenda', icon: CalendarDaysIcon },
      { title: 'Avisos', icon: BellIcon },
    ],
  },
] as const;

export default function TodosScreen() {
  const [search, setSearch] = useState('');
  const normalizedSearch = search.trim().toLocaleLowerCase();

  return (
    <Screen scroll backgroundColor={colors.surface} style={styles.screen}>
      <SearchField value={search} onChangeText={setSearch} placeholder="Pesquisar" accessibilityLabel="Pesquisar funções" returnKeyType="search" />

      {sections.map((section) => {
        const items = normalizedSearch
          ? section.items.filter((item) => item.title.toLocaleLowerCase().includes(normalizedSearch))
          : section.items;

        if (items.length === 0) return null;

        return (
          <View key={section.title} style={styles.section}>
            <AppText variant="subheading" weight="medium">{section.title}</AppText>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.cardRail}
            >
              {items.map((item) => (
                <PlaceholderCard key={item.title} title={item.title} icon={item.icon} onPress={getAction(item.title)} />
              ))}
            </ScrollView>
          </View>
        );
      })}
    </Screen>
  );
}

function getAction(title: string) {
  if (title === 'Alunos') return () => router.push('/(app)/students');
  if (title === 'Responsáveis') return () => router.push('/(app)/responsaveis');
  if (title === 'Turmas' || title === 'Matrículas') return () => router.push('/(app)/enrollments');
  if (title === 'Todas as cobranças') return () => router.push('/(app)/billing');
  if (title === 'Avulsas') return () => router.push('/(app)/avulsas');
  if (title === 'Parcelamentos') return () => router.push('/(app)/parcelamentos');
  if (title === 'Assinaturas') return () => router.push('/(app)/assinaturas');
  if (title === 'Relatório') return () => router.push('/(app)/report');
  if (title === 'Ler ingresso') return () => router.push('/(app)/ticket-scanner');
  if (title === 'Eventos') return () => router.push('/(app)/events');
  if (title === 'Agenda') return () => router.push('/(app)/agenda');
  return undefined;
}

function PlaceholderCard({
  title,
  icon: Icon,
  onPress,
}: {
  title: string;
  icon: typeof UserGroupIcon;
  onPress?: () => void;
}) {
  const label = onPress ? `Abrir ${title}` : `${title}, disponível em breve`;

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={label}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      <Icon color={colors.inkMuted} size={22} strokeWidth={1.8} />
      <AppText variant="small" weight="medium" numberOfLines={2}>{title}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    gap: spacing.xl,
    paddingBottom: 116,
  },
  section: {
    gap: spacing.md,
  },
  cardRail: {
    gap: spacing.md,
  },
  card: {
    width: 138,
    minHeight: 148,
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceNeutral,
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },
});

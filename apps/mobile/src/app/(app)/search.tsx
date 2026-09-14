import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View, type TextInput } from 'react-native';
import { router } from 'expo-router';
import {
  AcademicCapIcon,
  ArrowPathIcon,
  BanknotesIcon,
  BellIcon,
  CalendarDaysIcon,
  ClockIcon,
  ClipboardDocumentListIcon,
  CreditCardIcon,
  DocumentTextIcon,
  UserGroupIcon,
  UserIcon,
  XMarkIcon,
} from 'react-native-heroicons/outline';

import { Screen } from '@/components/layout/Screen';
import { SearchField } from '@/components/forms/SearchField';
import { AppText } from '@/components/primitives/AppText';
import {
  addSearchHistory,
  clearSearchHistory,
  readSearchHistory,
  removeSearchHistory,
} from '@/features/search/services/search-history';
import { colors, radius, spacing } from '@/theme/tokens';

const searchItems = [
  { title: 'Alunos', section: 'Gestão escolar', description: 'Consulte todos os alunos', icon: UserGroupIcon, route: '/(app)/students' as const, keywords: ['aluno', 'estudante'] },
  { title: 'Responsáveis', section: 'Gestão escolar', description: 'Acesse os responsáveis', icon: UserIcon, route: '/(app)/responsaveis' as const, keywords: ['responsável', 'familiar'] },
  { title: 'Turmas', section: 'Gestão escolar', description: 'Consulte as turmas e ocupação', icon: AcademicCapIcon, route: '/(app)/enrollments' as const, keywords: ['turma', 'classe'] },
  { title: 'Matrículas', section: 'Gestão escolar', description: 'Acompanhe matrículas e rematrículas', icon: ClipboardDocumentListIcon, route: '/(app)/enrollments' as const, keywords: ['matrícula', 'rematrícula'] },
  { title: 'Todas as cobranças', section: 'Cobrança', description: 'Consulte cobranças e vencimentos', icon: BanknotesIcon, route: '/(app)/billing' as const, keywords: ['cobrança', 'financeiro', 'vencimento'] },
  { title: 'Avulsas', section: 'Cobrança', description: 'Consulte cobranças avulsas', icon: CreditCardIcon, route: '/(app)/avulsas' as const, keywords: ['avulsa', 'pagamento'] },
  { title: 'Parcelamentos', section: 'Cobrança', description: 'Acompanhe cobranças parceladas', icon: DocumentTextIcon, route: '/(app)/parcelamentos' as const, keywords: ['parcelamento', 'parcelada'] },
  { title: 'Assinaturas', section: 'Cobrança', description: 'Acompanhe cobranças recorrentes', icon: ArrowPathIcon, route: '/(app)/assinaturas' as const, keywords: ['assinatura', 'recorrente'] },
  { title: 'Agenda', section: 'Comunicação', description: 'Consulte a agenda da escola', icon: CalendarDaysIcon, route: '/(app)/agenda' as const, keywords: ['agenda', 'evento'] },
  { title: 'Avisos', section: 'Comunicação', description: 'Veja os avisos da escola', icon: BellIcon, route: undefined, keywords: ['aviso', 'comunicado'] },
] as const;

type SearchItem = (typeof searchItems)[number];

export default function SearchScreen() {
  const inputRef = useRef<TextInput>(null);
  const [search, setSearch] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    let active = true;

    void readSearchHistory()
      .then((items) => {
        if (active) setHistory(items);
      })
      .catch(() => {
        if (active) setHistory([]);
      })
      .finally(() => {
        if (active) setHistoryLoaded(true);
      });

    return () => {
      active = false;
      cancelAnimationFrame(frame);
    };
  }, []);

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const matches = useMemo(
    () => normalizedSearch
      ? searchItems.filter((item) => [item.title, item.description, ...item.keywords].some((value) => value.toLocaleLowerCase().includes(normalizedSearch)))
      : [],
    [normalizedSearch],
  );
  const primaryMatch = matches[0];
  const suggestions = matches.slice(1);

  const openSearchItem = useCallback(async (item: SearchItem, term = search) => {
    const nextHistory = await addSearchHistory(term);
    setHistory(nextHistory);
    Keyboard.dismiss();
    if (item.route) router.push(item.route);
  }, [search]);

  const submitSearch = useCallback(() => {
    if (primaryMatch) void openSearchItem(primaryMatch);
  }, [openSearchItem, primaryMatch]);

  const selectHistoryItem = useCallback((term: string) => {
    setSearch(term);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const deleteHistoryItem = useCallback(async (term: string) => {
    setHistory(await removeSearchHistory(term));
  }, []);

  const clearHistory = useCallback(async () => {
    await clearSearchHistory();
    setHistory([]);
  }, []);

  return (
    <Screen scroll keyboard backgroundColor={colors.surface} style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerSpacer} />
        <AppText variant="subheading" weight="medium">Busca</AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fechar busca"
          hitSlop={10}
          onPress={() => router.back()}
          style={styles.headerAction}
        >
          <XMarkIcon color={colors.brand} size={27} strokeWidth={1.8} />
        </Pressable>
      </View>

      <SearchField
        ref={inputRef}
        variant="filled"
        value={search}
        onChangeText={setSearch}
        placeholder="Pesquisar"
        accessibilityLabel="Pesquisar no Alusa"
        returnKeyType="search"
        onSubmitEditing={submitSearch}
        rightElement={search ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Limpar busca"
            hitSlop={8}
            onPress={() => {
              setSearch('');
              inputRef.current?.focus();
            }}
          >
            <XMarkIcon color={colors.inkMuted} size={23} strokeWidth={1.8} />
          </Pressable>
        ) : undefined}
      />

      {!normalizedSearch ? (
        <View style={styles.contentSection}>
          <View style={styles.sectionHeader}>
            <AppText variant="subheading" weight="medium">Histórico</AppText>
            {history.length > 0 ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Limpar histórico de busca" onPress={() => void clearHistory()}>
                <AppText variant="small" weight="medium" style={styles.clearAction}>Limpar</AppText>
              </Pressable>
            ) : null}
          </View>
          {historyLoaded && history.length > 0 ? (
            <View style={styles.historyList}>
              {history.map((term) => (
                <View key={term.toLocaleLowerCase()} style={styles.historyRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Pesquisar novamente por ${term}`}
                    onPress={() => selectHistoryItem(term)}
                    style={styles.historyTerm}
                  >
                    <ClockIcon color={colors.ink} size={25} strokeWidth={1.7} />
                    <AppText variant="small" weight="medium" numberOfLines={1}>{term}</AppText>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remover ${term} do histórico`}
                    hitSlop={8}
                    onPress={() => void deleteHistoryItem(term)}
                    style={styles.historyRemove}
                  >
                    <XMarkIcon color={colors.white} size={13} strokeWidth={2.5} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.contentSection}>
          {primaryMatch ? <PrimaryResult item={primaryMatch} onPress={() => void openSearchItem(primaryMatch, search)} /> : null}
          {suggestions.length > 0 ? (
            <View style={styles.suggestionsSection}>
              <AppText variant="subheading" weight="medium">Sugestões</AppText>
              <View style={styles.suggestionList}>
                {suggestions.map((item) => <SuggestionRow key={item.title} item={item} onPress={() => void openSearchItem(item, search)} />)}
              </View>
            </View>
          ) : null}
          {!primaryMatch ? <SearchEmptyState /> : null}
        </View>
      )}
    </Screen>
  );
}

function SearchEmptyState() {
  return (
    <View style={styles.emptyState}>
      <AppText variant="subheading" weight="medium">Nenhum resultado encontrado</AppText>
      <AppText tone="muted">Tente buscar por aluno, turma, matrícula ou cobrança.</AppText>
    </View>
  );
}

function PrimaryResult({ item, onPress }: { item: SearchItem; onPress: () => void }) {
  const Icon = item.icon;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Abrir ${item.title}`}
      disabled={!item.route}
      onPress={onPress}
      style={({ pressed }) => [styles.primaryResult, pressed ? styles.pressed : null, !item.route ? styles.disabled : null]}
    >
      <View style={styles.primaryIcon}>
        <Icon color={colors.inkMuted} size={25} strokeWidth={1.8} />
      </View>
      <AppText variant="small" weight="medium" numberOfLines={2}>{item.title}</AppText>
    </Pressable>
  );
}

function SuggestionRow({ item, onPress }: { item: SearchItem; onPress: () => void }) {
  const Icon = item.icon;

  return (
    <Pressable
      accessibilityRole={item.route ? 'button' : undefined}
      accessibilityLabel={item.route ? `Abrir ${item.title}` : `${item.title}, disponível em breve`}
      disabled={!item.route}
      onPress={onPress}
      style={({ pressed }) => [styles.suggestionRow, pressed ? styles.pressed : null, !item.route ? styles.disabled : null]}
    >
      <Icon color={colors.ink} size={22} strokeWidth={1.8} />
      <AppText variant="small" weight="medium" numberOfLines={1}>{item.title}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { gap: spacing.lg, paddingBottom: spacing['2xl'] },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerSpacer: { width: 42 },
  headerAction: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  contentSection: { gap: spacing.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  clearAction: { color: colors.brand },
  historyList: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  historyRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  historyTerm: { flex: 1, minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  historyRemove: { width: 21, height: 21, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.ink },
  primaryResult: { width: 96, alignItems: 'flex-start', gap: spacing.sm },
  primaryIcon: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.brandSoft },
  suggestionsSection: { gap: spacing.md },
  suggestionList: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  suggestionRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  emptyState: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  disabled: { opacity: 0.62 },
  pressed: { opacity: 0.78 },
});

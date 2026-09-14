import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeftIcon, BanknotesIcon, BellAlertIcon, ChevronDownIcon, ChevronRightIcon, PencilSquareIcon, TrashIcon } from 'react-native-heroicons/outline';

import { ErrorState } from '@/components/feedback/ErrorState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { FloatingActionMenu, type FloatingAction } from '@/components/overlays/FloatingActionMenu';
import { Screen } from '@/components/layout/Screen';
import { AppText } from '@/components/primitives/AppText';
import { StudentAvatar } from '@/features/students/components/StudentAvatar';
import { responsibleService } from '@/features/responsibles/services/responsible-service';
import type { ResponsibleAddress, ResponsibleCharge, ResponsibleDetail, ResponsibleEnrollment, ResponsibleStudent } from '@/features/responsibles/types/responsible';
import { colors, radius, spacing } from '@/theme/tokens';

export default function ResponsibleDetailScreen() {
  const { responsibleId } = useLocalSearchParams<{ responsibleId?: string }>();
  const [responsible, setResponsible] = useState<ResponsibleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshInFlight = useRef(false);

  const load = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!responsibleId) { setError('Responsável não encontrado.'); setLoading(false); return; }
    if (!options.silent) setLoading(true);
    setError(null);
    try { setResponsible((await responsibleService.getResponsible(responsibleId)).responsible); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar o responsável.'); }
    finally { if (!options.silent) setLoading(false); }
  }, [responsibleId]);

  useEffect(() => { void load(); }, [load]);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true; setRefreshing(true);
    try { await load({ silent: true }); } finally { refreshInFlight.current = false; setRefreshing(false); }
  }, [load]);

  const confirmDelete = useCallback(() => {
    if (!responsibleId) return;
    Alert.alert('Excluir responsável?', 'Só será possível concluir se não houver alunos, matrículas ou cobranças vinculadas.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir responsável', style: 'destructive', onPress: async () => {
        try { await responsibleService.removeResponsible(responsibleId); router.back(); }
        catch (actionError) { Alert.alert('Não foi possível excluir', actionError instanceof Error ? actionError.message : 'Resolva os vínculos pendentes e tente novamente.'); }
      } },
    ]);
  }, [responsibleId]);

  const actions = useMemo<FloatingAction[]>(() => {
    if (!responsible || !responsibleId) return [];
    return [
      { key: 'edit', label: 'Editar dados', Icon: PencilSquareIcon, onPress: () => router.push({ pathname: '/(app)/responsaveis/[responsibleId]/edit', params: { responsibleId } }) },
      { key: 'charge', label: 'Criar cobrança', Icon: BanknotesIcon, onPress: () => router.push({ pathname: '/(app)/billing/create', params: { prefillPayerId: responsible.id, prefillPayerType: 'responsavel', prefillPayerName: responsible.name, prefillPayerPhoto: responsible.photo ?? '', prefillPayerCpf: responsible.cpf } }) },
      { key: 'notifications', label: 'Configurar avisos', Icon: BellAlertIcon, onPress: () => router.push({ pathname: '/(app)/responsaveis/[responsibleId]/notifications', params: { responsibleId } }) },
      { key: 'delete', label: 'Excluir responsável', Icon: TrashIcon, destructive: true, onPress: confirmDelete },
    ];
  }, [confirmDelete, responsible, responsibleId]);

  return <Screen scroll backgroundColor={colors.surface} style={styles.screen} refreshing={refreshing} onRefresh={() => void refresh()} overlay={!loading && responsible ? <FloatingActionMenu accessibilityLabel="ações do responsável" actions={actions} /> : undefined}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Voltar para responsáveis" hitSlop={10} onPress={() => router.back()} style={styles.headerButton}><ArrowLeftIcon color={colors.ink} size={25} strokeWidth={1.8} /></Pressable><AppText variant="heading" weight="medium" style={styles.headerTitle}>Detalhes do responsável</AppText><View style={styles.headerButton} /></View>
    {loading ? <DetailSkeleton /> : null}
    {!loading && error ? <ErrorState title="Não foi possível carregar" message={error} actionLabel="Tentar novamente" onAction={() => void load()} /> : null}
    {!loading && !error && responsible ? <ResponsibleContent responsible={responsible} /> : null}
  </Screen>;
}

function ResponsibleContent({ responsible }: { responsible: ResponsibleDetail }) {
  return <View style={styles.content}>
    <View style={styles.identityCard}><StudentAvatar name={responsible.name} photo={responsible.photo} size={76} /><View style={styles.identityCopy}><AppText variant="subheading" weight="medium" numberOfLines={1}>{responsible.name}</AppText><AppText variant="small" tone="muted" numberOfLines={1}>{responsible.financial ? 'Responsável financeiro' : 'Responsável'}</AppText><AppText variant="tiny" tone="muted" numberOfLines={1} ellipsizeMode="middle">Customer: {responsible.customer || 'Não cadastrado'}</AppText><StatusBadge status={responsible.status} /></View></View>
    <Disclosure title="Dados de contato"><InfoGrid rows={[["CPF", responsible.cpf], ["E-mail", responsible.email], ["Telefone", responsible.phone]]} /></Disclosure>
    <Disclosure title="Endereço"><AddressValue address={responsible.address} /></Disclosure>
    <Disclosure title={`Alunos vinculados (${responsible.metrics.students})`}><View style={styles.rows}>{responsible.students.length ? responsible.students.map((student) => <StudentRow key={student.id} student={student} />) : <EmptyCopy text="Nenhum aluno vinculado." />}</View></Disclosure>
    <Disclosure title={`Matrículas (${responsible.metrics.enrollments})`}><View style={styles.rows}>{responsible.enrollments.length ? responsible.enrollments.map((enrollment) => <EnrollmentRow key={enrollment.id} enrollment={enrollment} />) : <EmptyCopy text="Nenhuma matrícula financeira encontrada." />}</View></Disclosure>
    <Disclosure title="Cobranças"><View style={styles.rows}>{responsible.charges.length ? responsible.charges.map((charge) => <ChargeRow key={charge.id} charge={charge} />) : <EmptyCopy text="Nenhuma cobrança encontrada." />}</View></Disclosure>
    <Disclosure title="Assinaturas e parcelamentos"><View style={styles.rows}>{responsible.agreements.length ? responsible.agreements.map((agreement) => <AgreementRow key={`${agreement.kind}:${agreement.id}`} agreement={agreement} />) : <EmptyCopy text="Nenhuma assinatura ou parcelamento encontrado." />}</View></Disclosure>
    <SectionCard title="Configurações de avisos"><View style={styles.notice}><AppText variant="small" tone="muted">As preferências de comunicação deste responsável ficam disponíveis na ação “Configurar avisos”.</AppText></View><BooleanList rows={[["Comunicações permitidas", responsible.communicationConsent], ["Comunicações promocionais", responsible.marketingConsent]]} /></SectionCard>
  </View>;
}

function DetailSkeleton() { return <View style={styles.content} accessibilityLabel="Carregando detalhes do responsável"><View style={styles.identityCard}><Skeleton width={76} height={76} radius={radius.pill} /><View style={styles.flexCopy}><Skeleton width="70%" height={22} /><Skeleton width="48%" height={16} /><Skeleton width="88%" height={14} /><Skeleton width={84} height={26} radius={radius.pill} /></View></View>{[0, 1, 2, 3, 4].map((item) => <View key={item} style={styles.skeletonCard}><Skeleton width="52%" height={21} /><Skeleton width="86%" height={17} /><Skeleton width="64%" height={17} /></View>)}</View>; }
function SectionCard({ title, children }: { title: string; children: React.ReactNode }) { return <View style={styles.card}><AppText variant="subheading" weight="medium">{title}</AppText>{children}</View>; }
function Disclosure({ title, children }: { title: string; children: React.ReactNode }) { const [open, setOpen] = useState(true); return <View style={styles.card}><Pressable accessibilityRole="button" accessibilityLabel={`${open ? 'Recolher' : 'Expandir'} ${title}`} accessibilityState={{ expanded: open }} onPress={() => setOpen((value) => !value)} style={styles.sectionTitle}><AppText variant="subheading" weight="medium" style={styles.flexCopy}>{title}</AppText><ChevronDownIcon color={colors.inkMuted} size={21} strokeWidth={1.8} style={open ? undefined : styles.chevronClosed} /></Pressable>{open ? <View style={styles.sectionBody}>{children}</View> : null}</View>; }
function StatusBadge({ status }: { status: string }) { const active = status === 'ATIVO'; return <View style={[styles.statusBadge, { backgroundColor: active ? colors.accentSoft : colors.surfaceSoft }]}><View style={[styles.statusDot, { backgroundColor: active ? colors.success : colors.inkSubtle }]} /><AppText variant="small" weight="medium" style={{ color: active ? colors.success : colors.inkMuted }}>{active ? 'Ativo' : 'Inativo'}</AppText></View>; }
function InfoGrid({ rows }: { rows: Array<[string, string | null | undefined]> }) { return <View style={styles.infoGrid}>{rows.filter(([, value]) => value).map(([label, value]) => <View key={label} style={styles.infoItem}><AppText variant="small" tone="muted">{label}</AppText><AppText weight="medium" numberOfLines={label === 'E-mail' ? 1 : undefined} ellipsizeMode={label === 'E-mail' ? 'middle' : undefined}>{value}</AppText></View>)}</View>; }
function AddressValue({ address }: { address: ResponsibleAddress | null }) { if (!address) return <EmptyCopy text="Endereço não informado." />; return <InfoGrid rows={[["CEP", address.cep], ["Logradouro", address.street], ["Número", address.number], ["Complemento", address.complement], ["Bairro", address.neighborhood], ["Cidade", address.city], ["UF", address.state]]} />; }
function StudentRow({ student }: { student: ResponsibleStudent }) { return <Pressable accessibilityRole="button" accessibilityLabel={`Abrir detalhes de ${student.name}`} onPress={() => router.push({ pathname: '/(app)/students/[studentId]', params: { studentId: student.id } })} style={({ pressed }) => [styles.listRow, pressed ? styles.pressed : null]}><StudentAvatar name={student.name} photo={student.photo} size={44} /><View style={styles.flexCopy}><AppText weight="medium" numberOfLines={1}>{student.name}</AppText><AppText variant="small" tone="muted" numberOfLines={1}>{labelFor(student.relationship)} · {labelFor(student.status)}</AppText></View><ChevronRightIcon color={colors.inkMuted} size={20} strokeWidth={1.8} /></Pressable>; }
function EnrollmentRow({ enrollment }: { enrollment: ResponsibleEnrollment }) { const title = enrollment.planName || enrollment.comboName || enrollment.className || 'Matrícula'; return <Pressable accessibilityRole="button" accessibilityLabel={`Abrir matrícula de ${enrollment.studentName}`} onPress={() => router.push({ pathname: '/(app)/enrollments/detail/[enrollmentId]', params: { enrollmentId: enrollment.id } })} style={({ pressed }) => [styles.listRow, pressed ? styles.pressed : null]}><View style={styles.statusMarker}><View style={[styles.statusDot, { backgroundColor: statusColor(enrollment.status) }]} /><View style={styles.flexCopy}><AppText weight="medium" numberOfLines={1}>{enrollment.studentName}</AppText><AppText variant="small" tone="muted" numberOfLines={1}>{title}</AppText><AppText variant="tiny" tone="subtle" numberOfLines={1}>{labelFor(enrollment.status)} · {labelFor(enrollment.contractStatus)}</AppText></View></View><ChevronRightIcon color={colors.inkMuted} size={20} strokeWidth={1.8} /></Pressable>; }
function ChargeRow({ charge }: { charge: ResponsibleCharge }) { return <Pressable accessibilityRole="button" accessibilityLabel={`Abrir ${charge.description}`} onPress={() => router.push({ pathname: '/(app)/billing/[chargeId]', params: { chargeId: charge.id } })} style={({ pressed }) => [styles.listRow, pressed ? styles.pressed : null]}><View style={styles.statusMarker}><View style={[styles.statusDot, { backgroundColor: statusColor(charge.status) }]} /><View style={styles.flexCopy}><AppText weight="medium" numberOfLines={1}>{charge.description}</AppText><AppText variant="small" tone="muted" numberOfLines={1}>Vencimento: {formatDate(charge.dueDate)} · {labelFor(charge.status)}</AppText></View></View><View style={styles.trailing}><AppText weight="medium">{formatCurrency(charge.amount)}</AppText><ChevronRightIcon color={colors.inkMuted} size={20} strokeWidth={1.8} /></View></Pressable>; }
function AgreementRow({ agreement }: { agreement: ResponsibleDetail['agreements'][number] }) { return <View style={styles.listRow}><View style={styles.statusMarker}><View style={[styles.statusDot, { backgroundColor: statusColor(agreement.status) }]} /><View style={styles.flexCopy}><AppText weight="medium" numberOfLines={1}>{agreement.name}</AppText><AppText variant="small" tone="muted" numberOfLines={1}>{agreement.kind === 'SUBSCRIPTION' ? 'Assinatura' : 'Parcelamento'} · {labelFor(agreement.status)}</AppText></View></View>{agreement.value > 0 ? <AppText weight="medium">{formatCurrency(agreement.value)}</AppText> : null}</View>; }
function BooleanList({ rows }: { rows: Array<[string, boolean]> }) { return <View style={styles.booleanList}>{rows.map(([label, value]) => <View key={label} style={styles.booleanRow}><AppText variant="small" tone="muted" style={styles.flexCopy}>{label}</AppText><AppText variant="small" weight="medium" style={{ color: value ? colors.success : colors.inkSubtle }}>{value ? 'Sim' : 'Não'}</AppText></View>)}</View>; }
function EmptyCopy({ text }: { text: string }) { return <AppText variant="small" tone="muted">{text}</AppText>; }
function labelFor(value: string | null | undefined) { if (!value) return 'Não informado'; const labels: Record<string, string> = { ATIVO: 'Ativo', INATIVO: 'Inativo', ATIVA: 'Ativa', CANCELADA: 'Cancelada', CANCELADO: 'Cancelado', AGUARDANDO_ASSINATURA: 'Aguardando assinatura', ASSINADO: 'Assinado', PENDENTE_TAXA: 'Pendente da taxa', PENDENTE: 'Pendente', CREATED: 'Criada', OPEN: 'Em aberto', OVERDUE: 'Em atraso', RECEIVED: 'Recebida', RECEBIDO: 'Recebida', PAID: 'Paga', ACTIVE: 'Ativo', REQUESTED: 'Em configuração' }; return labels[value] ?? value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function statusColor(value: string | null | undefined) { const normalized = value?.toUpperCase(); if (['ATIVO', 'ATIVA', 'ACTIVE', 'RECEIVED', 'RECEBIDO', 'PAID', 'PAGO', 'ASSINADO'].includes(normalized ?? '')) return colors.success; if (['INATIVO', 'CANCELADO', 'CANCELADA', 'CANCELED', 'CANCELLED'].includes(normalized ?? '')) return colors.danger; if (['OPEN', 'OVERDUE', 'PENDENTE', 'PENDENTE_TAXA', 'REQUESTED', 'AGUARDANDO_ASSINATURA'].includes(normalized ?? '')) return colors.warning; return colors.inkSubtle; }
function formatDate(value: string | null | undefined) { if (!value) return 'Não informado'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Não informado' : date.toLocaleDateString('pt-BR'); }
function formatCurrency(value: number) { return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

const styles = StyleSheet.create({ screen: { gap: spacing.xl, paddingBottom: 128 }, header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.md }, headerButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }, headerTitle: { flex: 1 }, content: { gap: spacing.lg }, identityCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, padding: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.surfaceNeutral }, identityCopy: { flex: 1, minWidth: 0, gap: spacing.xs }, flexCopy: { flex: 1, minWidth: 0, gap: spacing.xs }, card: { gap: spacing.lg, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral }, sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.md }, sectionBody: { gap: spacing.lg, paddingTop: spacing.xs }, infoGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: spacing.lg }, infoItem: { width: '46%', minWidth: 0, gap: spacing.xs }, statusBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill }, statusDot: { width: 7, height: 7, borderRadius: radius.pill }, rows: { gap: spacing.sm }, listRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }, statusMarker: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, minWidth: 0 }, trailing: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, booleanList: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }, booleanRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md }, notice: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface }, chevronClosed: { transform: [{ rotate: '-90deg' }] }, pressed: { opacity: 0.76 }, skeletonCard: { gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral } });

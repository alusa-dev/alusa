import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeftIcon, BanknotesIcon, BellAlertIcon, ChevronRightIcon, PencilSquareIcon, PauseIcon, PlayIcon, TrashIcon, XCircleIcon } from 'react-native-heroicons/outline';

import { Button } from '@/components/primitives/Button';
import { AppText } from '@/components/primitives/AppText';
import { ErrorState } from '@/components/feedback/ErrorState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { FloatingActionMenu, type FloatingAction } from '@/components/overlays/FloatingActionMenu';
import { Screen } from '@/components/layout/Screen';
import { DateField, DatePickerSheet } from '@/components/forms/DateField';
import { SelectField } from '@/components/forms/SelectField';
import { TextField } from '@/components/primitives/TextField';
import { BottomSheet } from '@/components/overlays/BottomSheet';
import { enrollmentService } from '@/features/enrollments/services/enrollment-service';
import type { EnrollmentDetail } from '@/features/enrollments/types/enrollment';
import { StudentAvatar } from '@/features/students/components/StudentAvatar';
import { colors, radius, spacing } from '@/theme/tokens';

export default function EnrollmentDetailScreen() {
  const { enrollmentId } = useLocalSearchParams<{ enrollmentId?: string }>();
  const resolvedId = Array.isArray(enrollmentId) ? enrollmentId[0] : enrollmentId;
  const [detail, setDetail] = useState<EnrollmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    if (!resolvedId) { setError('Matrícula inválida.'); setLoading(false); return; }
    setLoading(true); setError(null);
    try { const response = await enrollmentService.getEnrollment(resolvedId); setDetail(response.enrollment); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar a matrícula.'); }
    finally { setLoading(false); }
  }, [resolvedId]);

  useEffect(() => { void load(); }, [load]);

  const runAction = useCallback((action: 'PAUSE' | 'REACTIVATE' | 'CANCEL') => {
    if (!resolvedId) return;
    const copy = action === 'PAUSE'
      ? { title: 'Pausar matrícula?', message: 'A matrícula ficará pausada até que você decida retomá-la.', confirm: 'Pausar' }
      : action === 'REACTIVATE'
        ? { title: 'Retomar matrícula?', message: 'A matrícula voltará a ficar ativa.', confirm: 'Retomar' }
        : { title: 'Encerrar matrícula?', message: 'O histórico será preservado e novas cobranças não serão geradas.', confirm: 'Encerrar' };
    Alert.alert(copy.title, copy.message, [
      { text: 'Cancelar', style: 'cancel' },
      { text: copy.confirm, style: action === 'CANCEL' ? 'destructive' : 'default', onPress: async () => {
        try { await enrollmentService.executeAction(resolvedId, { action }); await load(); }
        catch (actionError) { Alert.alert('Não foi possível concluir', actionError instanceof Error ? actionError.message : 'Tente novamente.'); }
      } },
    ]);
  }, [load, resolvedId]);

  const removeEnrollment = useCallback(() => {
    if (!resolvedId) return;
    Alert.alert('Excluir matrícula?', 'A exclusão só é permitida quando não há histórico ou vínculo financeiro. Caso contrário, encerre a matrícula para preservar os registros.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir', style: 'destructive', onPress: async () => { try { await enrollmentService.deleteEnrollment(resolvedId); router.back(); } catch (actionError) { Alert.alert('Não foi possível excluir', actionError instanceof Error ? actionError.message : 'Tente encerrar a matrícula para preservar o histórico.'); } } },
    ]);
  }, [resolvedId]);

  const actions = useMemo<FloatingAction[]>(() => {
    if (!detail || !resolvedId) return [];
    return [
      { key: 'edit', label: 'Editar matrícula', Icon: PencilSquareIcon, onPress: () => setEditing(true) },
      { key: 'charge', label: 'Criar cobrança', Icon: BanknotesIcon, onPress: () => router.push({ pathname: '/(app)/billing/create', params: { prefillPayerId: detail.responsible?.id || detail.student.id, prefillPayerType: detail.responsible ? 'responsavel' : 'aluno', prefillPayerName: detail.responsible?.name || detail.student.name, prefillPayerPhoto: detail.student.photo || '', prefillPayerCpf: detail.student.cpf || '' } }) },
      { key: 'notifications', label: 'Configurar avisos', Icon: BellAlertIcon, onPress: () => router.push({ pathname: '/(app)/students/[studentId]/notifications', params: { studentId: detail.student.id } }) },
      ...(detail.pause.active ? [{ key: 'reactivate', label: 'Retomar matrícula', Icon: PlayIcon, onPress: () => runAction('REACTIVATE') }] : [{ key: 'pause', label: 'Pausar matrícula', Icon: PauseIcon, onPress: () => runAction('PAUSE') }]),
      ...(detail.status !== 'CANCELADA' ? [{ key: 'cancel', label: 'Encerrar matrícula', Icon: XCircleIcon, destructive: true, onPress: () => runAction('CANCEL') }] : []),
      { key: 'delete', label: 'Excluir matrícula', Icon: TrashIcon, destructive: true, onPress: removeEnrollment },
    ];
  }, [detail, removeEnrollment, resolvedId, runAction]);

  return <Screen scroll backgroundColor={colors.surface} style={styles.screen} overlay={!loading && detail ? <FloatingActionMenu accessibilityLabel="ações da matrícula" actions={actions} /> : undefined}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Voltar" hitSlop={10} onPress={() => router.back()} style={styles.headerButton}><ArrowLeftIcon color={colors.ink} size={25} strokeWidth={1.8} /></Pressable><AppText variant="heading" weight="medium" style={styles.headerTitle}>Detalhes da matrícula</AppText><View style={styles.headerButton} /></View>
    {loading ? <EnrollmentSkeleton /> : null}
    {!loading && error ? <ErrorState title="Não foi possível carregar" message={error} actionLabel="Tentar novamente" onAction={() => void load()} /> : null}
    {!loading && !error && detail ? <EnrollmentContent detail={detail} onEdit={() => setEditing(true)} /> : null}
    {detail ? <EnrollmentEditSheet visible={editing} detail={detail} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void load(); }} /> : null}
  </Screen>;
}

function EnrollmentContent({ detail, onEdit }: { detail: EnrollmentDetail; onEdit: () => void }) {
  return <View style={styles.content}>
    <View style={styles.identityCard}><StudentAvatar name={detail.student.name} photo={detail.student.photo} size={68} /><View style={styles.flexCopy}><AppText variant="subheading" weight="medium" numberOfLines={1} ellipsizeMode="tail">{detail.student.name}</AppText><StatusBadge status={detail.status} /><AppText variant="tiny" tone="muted" numberOfLines={1} ellipsizeMode="middle">Customer: {detail.student.customer || 'Não cadastrado'}</AppText></View></View>
    <Section title="Dados do aluno"><InfoGrid rows={[["CPF", detail.student.cpf], ["E-mail", detail.student.email], ["Telefone", detail.student.phone], ["Responsável financeiro", detail.responsible?.name]]} /></Section>
    <Section title="Dados da matrícula" action={<Pressable accessibilityRole="button" accessibilityLabel="Editar dados da matrícula" onPress={onEdit}><PencilSquareIcon color={colors.brand} size={21} strokeWidth={1.8} /></Pressable>}><InfoGrid rows={[["Status", labelFor(detail.status)], ["Início", formatDate(detail.startDate)], ["Fim do contrato", formatDate(detail.contractEndDate)], ["Vencimento", `Dia ${detail.paymentDay}`], ["Status financeiro", labelFor(detail.financialStatus)], ["Status do contrato", labelFor(detail.contractStatus)]]} />{detail.pause.active ? <View style={styles.notice}><AppText variant="small" tone="muted">Pausa desde {formatDate(detail.pause.startedAt)}{detail.pause.expectedReturnAt ? ` · retorno em ${formatDate(detail.pause.expectedReturnAt)}` : ''}</AppText></View> : null}</Section>
    <Section title="Plano e turma" action={<Pressable accessibilityRole="button" accessibilityLabel="Editar plano e turma" onPress={onEdit}><PencilSquareIcon color={colors.brand} size={21} strokeWidth={1.8} /></Pressable>}><InfoGrid rows={[["Plano", detail.plan?.name || detail.combo?.name], ["Valor", formatCurrency(detail.plan?.value || detail.combo?.value || 0)], ["Turma", detail.class?.name], ["Horário", detail.class ? `${detail.class.startTime} às ${detail.class.endTime}` : null], ["Dias", detail.class?.days.join(' · ')]]} /></Section>
    <Section title="Taxa de matrícula"><InfoGrid rows={[["Valor", detail.enrollmentFeeExempt ? 'Isenta' : formatCurrency(detail.enrollmentFee)], ["Status", labelFor(detail.enrollmentFeeStatus)], ["Forma de pagamento", paymentLabel(detail.enrollmentFeePaymentMethod)]]} /></Section>
    <Section title="Configurações de pagamento" action={<Pressable accessibilityRole="button" accessibilityLabel="Editar configurações de pagamento" onPress={onEdit}><PencilSquareIcon color={colors.brand} size={21} strokeWidth={1.8} /></Pressable>}><InfoGrid rows={[["Forma de pagamento", paymentLabel(detail.paymentMethod)], ["Juros", detail.interestPercent === null ? null : `${detail.interestPercent}% ao mês`], ["Multa", detail.finePercent === null ? null : `${detail.finePercent}%`], ["Desconto", detail.discountPercent === null ? null : `${detail.discountPercent}%`]]} /></Section>
    <Section title="Contratos"><ListRows items={detail.contracts.map((contract) => ({ title: 'Contrato de matrícula', subtitle: `${labelFor(contract.status)} · Criado em ${formatDate(contract.createdAt)}`, status: contract.status }))} empty="Nenhum contrato encontrado." /></Section>
    <Section title="Cobranças"><ListRows items={detail.charges.map((charge) => ({ title: charge.description, subtitle: `Vencimento: ${formatDate(charge.dueDate)} · ${labelFor(charge.status)}`, amount: formatCurrency(charge.amount), onPress: () => router.push({ pathname: '/(app)/billing/[chargeId]', params: { chargeId: charge.id } }) }))} empty="Nenhuma cobrança encontrada." /></Section>
  </View>;
}

function EnrollmentEditSheet({ visible, detail, onClose, onSaved }: { visible: boolean; detail: EnrollmentDetail; onClose: () => void; onSaved: () => void }) {
  const [endDate, setEndDate] = useState(new Date(detail.contractEndDate));
  const [paymentDay, setPaymentDay] = useState(String(detail.paymentDay));
  const [planId, setPlanId] = useState(detail.plan?.id ?? '');
  const [classId, setClassId] = useState(detail.class?.id ?? '');
  const [paymentMethod, setPaymentMethod] = useState(detail.paymentMethod ?? 'INDEFINIDO');
  const [datePicker, setDatePicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { if (visible) { setEndDate(new Date(detail.contractEndDate)); setPaymentDay(String(detail.paymentDay)); setPlanId(detail.plan?.id ?? ''); setClassId(detail.class?.id ?? ''); setPaymentMethod(detail.paymentMethod ?? 'INDEFINIDO'); setMessage(null); } }, [detail.class?.id, detail.contractEndDate, detail.paymentDay, detail.paymentMethod, detail.plan?.id, visible]);
  const save = async () => { const day = Number(paymentDay); if (!Number.isInteger(day) || day < 1 || day > 28) { setMessage('Escolha um dia entre 1 e 28.'); return; } setSaving(true); setMessage(null); try { await enrollmentService.updateEnrollment(detail.id, { dataFimContrato: dateToInput(endDate), vencimentoDia: day, planoId: planId || null, comboId: detail.combo?.id ?? null, turmaId: classId || null, paymentMethod: paymentMethod as 'BOLETO' | 'PIX' | 'CARTAO_CREDITO' | 'INDEFINIDO' }); onSaved(); } catch (saveError) { setMessage(saveError instanceof Error ? saveError.message : 'Não foi possível salvar.'); } finally { setSaving(false); } };
  return <BottomSheet visible={visible} onClose={onClose} maxHeight="88%" accessibilityLabel="Editar matrícula"><AppText variant="subheading" weight="medium">Editar matrícula</AppText><View style={styles.sheetBody}><TextField label="Aluno" value={detail.student.name} editable={false} /><SelectField label="Plano" value={detail.options.plans.find((plan) => plan.id === planId)?.name ?? 'Selecione um plano'} selectedValue={planId} onValueChange={setPlanId} options={[{ value: '', label: 'Selecione um plano' }, ...detail.options.plans.map((plan) => ({ value: plan.id, label: `${plan.name} · ${formatCurrency(plan.value)}` }))]} /><SelectField label="Turma" value={detail.options.classes.find((item) => item.id === classId)?.name ?? 'Selecione uma turma'} selectedValue={classId} onValueChange={setClassId} options={[{ value: '', label: 'Selecione uma turma' }, ...detail.options.classes.map((item) => ({ value: item.id, label: item.name }))]} /><SelectField label="Forma de pagamento" value={paymentLabel(paymentMethod)} selectedValue={paymentMethod} onValueChange={(value) => setPaymentMethod(value)} options={[{ value: 'BOLETO', label: 'Boleto bancário' }, { value: 'PIX', label: 'Pix' }, { value: 'CARTAO_CREDITO', label: 'Cartão de crédito' }, { value: 'INDEFINIDO', label: 'Cliente escolhe' }]} /><DateField label="Fim do contrato" value={formatDate(endDate.toISOString())} onPress={() => setDatePicker(true)} /><SelectField label="Dia de vencimento" value={`Dia ${paymentDay}`} selectedValue={paymentDay} onValueChange={setPaymentDay} options={Array.from({ length: 28 }, (_, index) => ({ value: String(index + 1), label: `Dia ${index + 1}` }))} />{message ? <AppText variant="small" tone="danger">{message}</AppText> : null}<Button title="Salvar alterações" loading={saving} onPress={() => void save()} /></View><DatePickerSheet visible={datePicker} selectedDate={endDate} minimumDate={new Date(detail.startDate)} onDateChange={(_, value) => value && setEndDate(value)} onClose={() => setDatePicker(false)} onConfirm={() => setDatePicker(false)} /></BottomSheet>;
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) { return <View style={styles.card}><View style={styles.sectionHeader}><AppText variant="subheading" weight="medium" style={styles.flexCopy}>{title}</AppText>{action}</View>{children}</View>; }
function InfoGrid({ rows }: { rows: Array<[string, string | null | undefined]> }) { return <View style={styles.infoGrid}>{rows.filter(([, value]) => value).map(([label, value]) => <View key={label} style={styles.infoItem}><AppText variant="small" tone="muted">{label}</AppText><AppText weight="medium" numberOfLines={label === 'E-mail' ? 1 : undefined} ellipsizeMode={label === 'E-mail' ? 'middle' : undefined}>{value}</AppText></View>)}</View>; }
function ListRows({ items, empty }: { items: Array<{ title: string; subtitle: string; amount?: string; status?: string; onPress?: () => void }>; empty: string }) { if (!items.length) return <AppText variant="small" tone="muted">{empty}</AppText>; return <View>{items.map((item, index) => { const content = <><View style={styles.listMarker}><View style={[styles.statusDot, { backgroundColor: statusColor(item.status) }]} /></View><View style={styles.flexCopy}><AppText weight="medium" numberOfLines={1}>{item.title}</AppText><AppText variant="small" tone="muted" numberOfLines={1}>{item.subtitle}</AppText></View>{item.amount ? <AppText weight="medium">{item.amount}</AppText> : null}{item.onPress ? <ChevronRightIcon color={colors.inkMuted} size={20} strokeWidth={1.8} /> : null}</>; return item.onPress ? <Pressable key={`${item.title}:${index}`} accessibilityRole="button" onPress={item.onPress} style={({ pressed }) => [styles.listRow, pressed ? styles.pressed : null]}>{content}</Pressable> : <View key={`${item.title}:${index}`} style={styles.listRow}>{content}</View>; })}</View>; }
function EnrollmentSkeleton() { return <View style={styles.content} accessibilityLabel="Carregando matrícula"><View style={styles.identityCard}><Skeleton width={68} height={68} radius={radius.pill} /><View style={styles.flexCopy}><Skeleton width="68%" height={22} /><Skeleton width={90} height={22} radius={radius.pill} /><Skeleton width="52%" height={14} /></View></View>{[0, 1, 2, 3, 4, 5].map((item) => <View key={item} style={styles.skeletonCard}><Skeleton width="42%" height={21} /><Skeleton width="82%" height={17} /><Skeleton width="62%" height={17} /></View>)}</View>; }
function StatusBadge({ status }: { status: string }) { const color = statusColor(status); return <View style={[styles.statusBadge, { backgroundColor: color === colors.danger ? colors.dangerSoft : color === colors.warning ? '#FFF1D9' : colors.accentSoft }]}><View style={[styles.statusDot, { backgroundColor: color }]} /><AppText variant="small" weight="medium" style={{ color }}>{labelFor(status)}</AppText></View>; }
function statusColor(status?: string) { const normalized = status?.toUpperCase(); if (['ATIVA', 'ATIVO', 'PAGO', 'RECEBIDO', 'ASSINADO', 'CONFIRMADA'].includes(normalized || '')) return colors.success; if (['CANCELADA', 'CANCELADO', 'INATIVO', 'ATRASADO', 'OVERDUE'].includes(normalized || '')) return colors.danger; if (['PAUSADA', 'PENDENTE', 'PENDENTE_TAXA', 'AGUARDANDO_ASSINATURA'].includes(normalized || '')) return colors.warning; return colors.inkSubtle; }
function labelFor(value: string | null | undefined) { if (!value) return 'Não informado'; const labels: Record<string, string> = { ATIVA: 'Ativa', ATIVO: 'Ativo', PAUSADA: 'Pausada', CANCELADA: 'Cancelada', PENDENTE_TAXA: 'Pendente da taxa', AGUARDANDO_ASSINATURA: 'Aguardando assinatura', ASSINADO: 'Assinado', ADIMPLENTE: 'Em dia', PENDENTE: 'Pendente', ATRASADO: 'Em atraso', PAGO: 'Pago', RECEBIDO: 'Recebido' }; return labels[value] ?? value.toLowerCase().replaceAll('_', ' '); }
function paymentLabel(value: string | null | undefined) { const labels: Record<string, string> = { BOLETO: 'Boleto bancário', PIX: 'Pix', CARTAO_CREDITO: 'Cartão de crédito', CREDIT_CARD: 'Cartão de crédito', UNDEFINED: 'Cliente escolhe' }; return value ? labels[value] ?? labelFor(value) : 'Não informado'; }
function formatDate(value: string | Date | null | undefined) { if (!value) return 'Não informado'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Não informado' : date.toLocaleDateString('pt-BR'); }
function dateToInput(value: Date) { const year = value.getFullYear(); const month = String(value.getMonth() + 1).padStart(2, '0'); const day = String(value.getDate()).padStart(2, '0'); return `${year}-${month}-${day}`; }
function formatCurrency(value: number) { return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

const styles = StyleSheet.create({ screen: { gap: spacing.xl, paddingBottom: 128 }, header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.md }, headerButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }, headerTitle: { flex: 1 }, content: { gap: spacing.lg }, identityCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, padding: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.surfaceNeutral }, flexCopy: { flex: 1, gap: spacing.xs }, card: { gap: spacing.lg, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral }, sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md }, infoGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: spacing.lg }, infoItem: { width: '46%', minWidth: 0, gap: spacing.xs }, statusBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill }, statusDot: { width: 7, height: 7, borderRadius: radius.pill }, notice: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface }, listRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }, listMarker: { width: 18, alignItems: 'center' }, sheetBody: { gap: spacing.lg }, skeletonCard: { gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral }, pressed: { opacity: 0.78 } });

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeftIcon,
  BanknotesIcon,
  BellAlertIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  PencilSquareIcon,
  TrashIcon,
} from 'react-native-heroicons/outline';

import { ErrorState } from '@/components/feedback/ErrorState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { FloatingActionMenu, type FloatingAction } from '@/components/overlays/FloatingActionMenu';
import { Screen } from '@/components/layout/Screen';
import { AppText } from '@/components/primitives/AppText';
import { StudentAvatar } from '@/features/students/components/StudentAvatar';
import { studentService } from '@/features/students/services/student-service';
import type { StudentAddress, StudentCharge, StudentDetail, StudentEnrollment, StudentNotifications, StudentResponsible } from '@/features/students/types/student';
import { colors, radius, spacing } from '@/theme/tokens';

export default function StudentDetailScreen() {
  const { studentId } = useLocalSearchParams<{ studentId?: string }>();
  const [student, setStudent] = useState<StudentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStudent = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!studentId) {
      setError('Aluno não encontrado.');
      setLoading(false);
      return;
    }
    if (!options.silent) setLoading(true);
    setError(null);
    try {
      const response = await studentService.getStudent(studentId);
      let detail = response.student;
      try {
        const notifications = await studentService.getNotifications(studentId);
        detail = { ...detail, notifications };
      } catch {
        // A ficha continua disponível mesmo quando a integração de avisos não responde.
      }
      setStudent(detail);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar o aluno.');
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, [studentId]);

  useEffect(() => { void loadStudent(); }, [loadStudent]);
  const refreshInFlight = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    try {
      await loadStudent({ silent: true });
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  }, [loadStudent]);

  const confirmDelete = useCallback((id: string) => {
    Alert.alert('Excluir aluno?', 'Essa ação preserva os históricos quando necessário e pode exigir que matrículas ou cobranças sejam resolvidas antes.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir aluno', style: 'destructive', onPress: async () => { try { await studentService.removeStudent(id, 'Exclusão solicitada pelo usuário'); router.back(); } catch (actionError) { Alert.alert('Não foi possível excluir', actionError instanceof Error ? actionError.message : 'Tente novamente.'); } } },
    ]);
  }, []);

  const actions = useMemo<FloatingAction[]>(() => {
    if (!student || !studentId) return [];
    const payer = student.responsible?.financial ? student.responsible : student;
    const payerType = student.responsible?.financial ? 'responsavel' : 'aluno';
    return [
      { key: 'edit', label: 'Editar dados', Icon: PencilSquareIcon, onPress: () => router.push({ pathname: '/(app)/students/[studentId]/edit', params: { studentId } }) },
      { key: 'charge', label: 'Criar cobrança', Icon: BanknotesIcon, onPress: () => router.push({ pathname: '/(app)/billing/create', params: { prefillPayerId: payer.id, prefillPayerType: payerType, prefillPayerName: payer.name, prefillPayerPhoto: payer.photo ?? '', prefillPayerCpf: payer.cpf ?? '' } }) },
      { key: 'notifications', label: 'Configurar avisos', Icon: BellAlertIcon, onPress: () => router.push({ pathname: '/(app)/students/[studentId]/notifications', params: { studentId } }) },
      { key: 'delete', label: 'Excluir aluno', Icon: TrashIcon, destructive: true, onPress: () => confirmDelete(studentId) },
    ];
  }, [confirmDelete, student, studentId]);

  return (
    <Screen scroll backgroundColor={colors.surface} style={styles.screen} refreshing={refreshing} onRefresh={() => void refresh()} overlay={!loading && student ? <FloatingActionMenu accessibilityLabel="ações do aluno" actions={actions} /> : undefined}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Voltar para alunos" hitSlop={10} onPress={() => router.back()} style={styles.headerButton}><ArrowLeftIcon color={colors.ink} size={25} strokeWidth={1.8} /></Pressable>
        <AppText variant="heading" weight="medium" style={styles.headerTitle}>Detalhes do aluno</AppText>
        <View style={styles.headerButton} />
      </View>

      {loading ? <StudentDetailSkeleton /> : null}
      {!loading && error ? <ErrorState title="Não foi possível carregar" message={error} actionLabel="Tentar novamente" onAction={() => void loadStudent()} /> : null}
      {!loading && !error && student ? <StudentContent student={student} onEditPhoto={() => router.push({ pathname: '/(app)/students/[studentId]/edit', params: { studentId: student.id, focus: 'photo' } })} onEditNotifications={() => router.push({ pathname: '/(app)/students/[studentId]/notifications', params: { studentId: student.id } })} /> : null}
    </Screen>
  );
}

function StudentContent({ student, onEditPhoto, onEditNotifications }: { student: StudentDetail; onEditPhoto: () => void; onEditNotifications: () => void }) {
  return (
    <View style={styles.content}>
      <View style={styles.identityCard}>
        <Pressable accessibilityRole="button" accessibilityLabel="Editar foto do aluno" onPress={onEditPhoto} style={styles.avatarWrap}>
          <StudentAvatar name={student.name} photo={student.photo} size={88} />
          <View style={styles.avatarEdit}><PencilSquareIcon color={colors.brand} size={17} strokeWidth={1.8} /></View>
        </Pressable>
        <View style={styles.identityCopy}>
          <AppText variant="subheading" weight="medium" numberOfLines={1} ellipsizeMode="tail">{student.socialName || student.name}</AppText>
          {student.socialName ? <AppText variant="small" tone="muted" numberOfLines={1}>{student.name}</AppText> : null}
          <AppText variant="tiny" tone="muted" numberOfLines={1} ellipsizeMode="middle">Customer: {student.asaasCustomerId || 'Não cadastrado'}</AppText>
          <StatusBadge status={student.status} />
          {student.status === 'INATIVO' ? <AppText variant="tiny" tone="muted">Inativado em {formatDate(student.deactivatedAt)}{student.deactivationReason ? ` · ${student.deactivationReason}` : ''}</AppText> : null}
        </View>
      </View>

      <DisclosureSection title="Dados pessoais">
        <InfoGrid rows={[
          ['CPF', student.cpf], ['E-mail', student.email], ['Telefone', student.phone], ['Data de nascimento', formatDate(student.birthDate)], ['Gênero', labelFor(student.gender)], ['Código interno', student.internalCode],
        ]} />
      </DisclosureSection>

      <DisclosureSection title="Informações complementares">
        <InfoGrid rows={[
          ['Modalidade principal', student.mainModality], ['Nível', student.level], ['Origem do cadastro', student.registrationOrigin], ['Bolsa ou desconto', student.discountPercent === null ? null : `${student.discountPercent}%`], ['Tamanho de camiseta', student.shirtSize], ['Tamanho de calçado', student.shoeSize],
        ]} />
        <BooleanList rows={[
          ['Isento da taxa de matrícula', student.registrationFeeExempt], ['Consentimento de imagem', student.imageConsent], ['Comunicações permitidas', student.communicationConsent], ['Comunicações promocionais', student.marketingConsent],
        ]} />
        <LongValue label="Alergias" value={student.allergies} />
        <LongValue label="Restrições médicas" value={student.medicalRestrictions} />
        <LongValue label="Observações" value={student.notes} />
      </DisclosureSection>

      <DisclosureSection title="Endereço">
        <AddressValue address={student.address} />
      </DisclosureSection>

      <DisclosureSection title="Contato de emergência">
        <InfoGrid rows={[["Nome", student.emergencyContactName], ['Telefone', student.emergencyContactPhone]]} />
      </DisclosureSection>

      <DisclosureSection title="Responsáveis">
        {student.responsibles.length ? student.responsibles.map((responsible) => <ResponsibleRow key={`${responsible.id}:${responsible.relationship}`} responsible={responsible} />) : <EmptyCopy text="Nenhum responsável cadastrado." />}
      </DisclosureSection>

      <DisclosureSection title="Matrículas">
        {student.enrollments.length ? student.enrollments.map((enrollment) => <EnrollmentRow key={enrollment.id} enrollment={enrollment} onPress={() => router.push({ pathname: '/(app)/enrollments/detail/[enrollmentId]', params: { enrollmentId: enrollment.id } })} />) : <EmptyCopy text="Nenhuma matrícula encontrada." />}
      </DisclosureSection>

      <DisclosureSection title="Contratos">
        {student.enrollments.flatMap((enrollment) => enrollment.contracts).length ? student.enrollments.flatMap((enrollment) => enrollment.contracts).map((contract) => <View key={`contract:${contract.id}`} style={styles.listRow}><View style={styles.statusMarker}><View style={[styles.statusDot, { backgroundColor: statusColor(contract.status) }]} /><View style={styles.flexCopy}><AppText weight="medium" numberOfLines={1}>Contrato de matrícula</AppText><AppText variant="small" tone="muted">{labelFor(contract.status)}</AppText></View></View></View>) : <EmptyCopy text="Nenhum contrato encontrado." />}
      </DisclosureSection>

      <DisclosureSection title="Cobranças">
        {student.charges.length ? student.charges.slice(0, 20).map((charge) => <ChargeRow key={`${charge.origin}:${charge.id}`} charge={charge} />) : <EmptyCopy text="Nenhuma cobrança encontrada." />}
      </DisclosureSection>

      <NotificationSummary notifications={student.notifications} onEdit={onEditNotifications} />
    </View>
  );
}

function StudentDetailSkeleton() {
  return <View style={styles.content} accessibilityLabel="Carregando detalhes do aluno"><View style={styles.identityCard}><Skeleton width={88} height={88} radius={radius.pill} /><View style={styles.flexCopy}><Skeleton width="70%" height={22} /><Skeleton width="42%" height={16} /><Skeleton width={92} height={28} radius={radius.pill} /></View></View>{[0, 1, 2, 3, 4, 5].map((item) => <View key={item} style={styles.skeletonCard}><Skeleton width="48%" height={21} /><Skeleton width="86%" height={17} /><Skeleton width="66%" height={17} /></View>)}</View>;
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.card}><View style={styles.sectionTitle}><AppText variant="subheading" weight="medium">{title}</AppText></View>{children}</View>;
}

function DisclosureSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return <View style={styles.card}><Pressable accessibilityRole="button" accessibilityLabel={`${open ? 'Recolher' : 'Expandir'} ${title}`} accessibilityState={{ expanded: open }} onPress={() => setOpen((value) => !value)} style={styles.sectionTitle}><AppText variant="subheading" weight="medium" style={styles.flexCopy}>{title}</AppText><ChevronDownIcon color={colors.inkMuted} size={21} strokeWidth={1.8} style={open ? undefined : styles.chevronClosed} /></Pressable>{open ? <View style={styles.sectionBody}>{children}</View> : null}</View>;
}

function StatusBadge({ status }: { status: string }) {
  const inactive = status === 'INATIVO';
  return <View style={[styles.statusBadge, { backgroundColor: inactive ? colors.dangerSoft : colors.accentSoft }]}><View style={[styles.statusDot, { backgroundColor: inactive ? colors.danger : colors.success }]} /><AppText variant="small" weight="medium" style={{ color: inactive ? colors.danger : colors.success }}>{inactive ? 'Inativo' : 'Ativo'}</AppText></View>;
}

function statusColor(value: string | null | undefined) {
  const normalized = value?.toUpperCase();
  if (!normalized) return colors.inkSubtle;
  if (['ATIVO', 'ATIVA', 'PAUSADA', 'CONFIRMADA', 'ASSINADO', 'RECEBIDO', 'PAGO', 'PAID', 'COMPLETED'].includes(normalized)) return colors.success;
  if (['INATIVO', 'CANCELADO', 'CANCELADA', 'CANCELED', 'CANCELLED', 'REFUNDED', 'ESTORNADO'].includes(normalized)) return colors.danger;
  if (['AGUARDANDO_ASSINATURA', 'PENDENTE', 'PENDENTE_TAXA', 'A_VENCER', 'OPEN', 'OVERDUE', 'CREATED', 'REQUESTED'].includes(normalized)) return colors.warning;
  return colors.inkSubtle;
}

function InfoGrid({ rows }: { rows: Array<[string, string | null | undefined]> }) {
  return <View style={styles.infoGrid}>{rows.filter(([, value]) => value).map(([label, value]) => <View key={label} style={styles.infoItem}><AppText variant="small" tone="muted">{label}</AppText><AppText weight="medium" numberOfLines={label === 'E-mail' ? 1 : undefined} ellipsizeMode={label === 'E-mail' ? 'middle' : undefined}>{value}</AppText></View>)}</View>;
}

function BooleanList({ rows }: { rows: Array<[string, boolean]> }) {
  return <View style={styles.booleanList}>{rows.map(([label, value]) => <View key={label} style={styles.booleanRow}><AppText variant="small" tone="muted" style={styles.flexCopy}>{label}</AppText><AppText variant="small" weight="medium" style={{ color: value ? colors.success : colors.inkSubtle }}>{value ? 'Sim' : 'Não'}</AppText></View>)}</View>;
}

function LongValue({ label, value }: { label: string; value: string | null }) {
  return value ? <View style={styles.longValue}><AppText variant="small" tone="muted">{label}</AppText><AppText>{value}</AppText></View> : null;
}

function AddressValue({ address }: { address: StudentAddress | null }) {
  if (!address) return <EmptyCopy text="Endereço não informado." />;
  return <InfoGrid rows={[["CEP", address.cep], ["Logradouro", address.street], ["Número", address.number], ["Complemento", address.complement], ["Bairro", address.neighborhood], ["Cidade", address.city], ["UF", address.state]]} />;
}

function ResponsibleRow({ responsible }: { responsible: StudentResponsible }) {
  return <View style={styles.responsibleBlock}><View style={styles.listRow}><StudentAvatar name={responsible.name} photo={responsible.photo} size={44} /><View style={styles.flexCopy}><AppText weight="medium">{responsible.name}</AppText><AppText variant="small" tone="muted">{responsible.financial ? 'Responsável financeiro' : labelFor(responsible.relationship)}</AppText><AppText variant="small" tone="muted">{responsible.email || responsible.phone || 'Contato não informado'}</AppText></View></View><InfoGrid rows={[["CPF", responsible.cpf], ['E-mail', responsible.email], ['Telefone', responsible.phone], ['Vínculo', labelFor(responsible.relationship)]]} /><BooleanList rows={[["Comunicações permitidas", responsible.communicationConsent], ["Comunicações promocionais", responsible.marketingConsent]]} /><AddressValue address={responsible.address} /></View>;
}

function EnrollmentRow({ enrollment, onPress }: { enrollment: StudentEnrollment; onPress: () => void }) {
  const name = enrollment.class?.name || enrollment.plan?.name || enrollment.combo?.name || 'Matrícula';
  return <Pressable accessibilityRole="button" accessibilityLabel={`Abrir matrícula de ${name}`} onPress={onPress} style={({ pressed }) => [styles.listRow, pressed ? styles.pressed : null]}><View style={styles.statusMarker}><View style={[styles.statusDot, { backgroundColor: statusColor(enrollment.status) }]} /><View style={styles.flexCopy}><AppText weight="medium" numberOfLines={1} ellipsizeMode="tail">{name}</AppText><AppText variant="small" tone="muted">{labelFor(enrollment.status)}</AppText></View></View><ChevronRightIcon color={colors.inkMuted} size={20} strokeWidth={1.8} /></Pressable>;
}

function ChargeRow({ charge }: { charge: StudentCharge }) {
  return <View style={styles.listRow}><View style={styles.flexCopy}><AppText weight="medium">{charge.description}</AppText><AppText variant="small" tone="muted">Vencimento: {formatDate(charge.dueDate)} · {labelFor(charge.status)}</AppText><AppText variant="tiny" tone="subtle">{paymentMethodFor(charge.paymentMethod)} · Criada em {formatDate(charge.createdAt)}</AppText></View><AppText variant="body" weight="medium">{formatCurrency(charge.amount)}</AppText></View>;
}

function NotificationSummary({ notifications, onEdit }: { notifications: StudentNotifications; onEdit: () => void }) {
  return <SectionCard title="Configurações de avisos"><View style={styles.notificationNotice}><AppText variant="small" tone="muted">{notifications.source === 'responsible' && notifications.recipientName ? `Avisos enviados para ${notifications.recipientName}.` : notifications.source === 'student' ? 'Avisos enviados diretamente ao aluno.' : 'As configurações de avisos ainda não estão disponíveis.'}</AppText></View>{notifications.preferences.length ? <View style={styles.notificationList}>{notifications.preferences.map((preference) => <View key={preference.id} style={styles.notificationRow}><View style={styles.flexCopy}><AppText variant="small" weight="medium">{notificationLabel(preference.event)}</AppText><AppText variant="tiny" tone="muted">{preference.enabled ? notificationSchedule(preference) : 'Desativado'}</AppText></View><ChannelDots preference={preference} /></View>)}</View> : null}<Pressable accessibilityRole="button" accessibilityLabel="Editar configurações de avisos" onPress={onEdit} style={styles.outlineButton}><AppText variant="small" weight="medium" style={styles.outlineText}>Ver e editar configurações</AppText></Pressable></SectionCard>;
}

function ChannelDots({ preference }: { preference: StudentNotifications['preferences'][number] }) {
  const items = [[preference.whatsappEnabledForCustomer, 'W'], [preference.emailEnabledForCustomer, '@'], [preference.smsEnabledForCustomer, 'SMS'], [preference.phoneCallEnabledForCustomer, '☎']] as const;
  return <View style={styles.channelDots}>{items.map(([active, label], index) => <View key={`${label}:${index}`} style={[styles.channelDot, active ? styles.channelDotActive : null]}><AppText variant="tiny" weight="medium" style={active ? styles.channelTextActive : styles.channelText}>{label}</AppText></View>)}</View>;
}

function EmptyCopy({ text }: { text: string }) { return <AppText variant="small" tone="muted">{text}</AppText>; }
function formatDate(value: string | null | undefined) { if (!value) return 'Não informado'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Não informado' : date.toLocaleDateString('pt-BR'); }
function formatCurrency(value: number) { return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function labelFor(value: string | null | undefined) { if (!value) return 'Não informado'; const labels: Record<string, string> = { ATIVA: 'Ativa', INATIVO: 'Inativo', ATIVO: 'Ativo', PENDENTE_TAXA: 'Pendente da taxa', AGUARDANDO_ASSINATURA: 'Aguardando assinatura', ASSINADO: 'Assinado', CANCELADO: 'Cancelado', CANCELLED: 'Cancelado', CREATED: 'Criada', CONFIRMED: 'Confirmada', PENDENTE: 'Pendente', A_VENCER: 'A vencer', ATRASADO: 'Em atraso', RECEBIDO: 'Recebido', RECEIVED: 'Recebido', PAGO: 'Pago', PAID: 'Pago', OPEN: 'Em aberto', OVERDUE: 'Em atraso', ACTIVE: 'Ativo', REQUESTED: 'Em configuração', COMPLETED: 'Concluído', CANCELED: 'Cancelado' }; return labels[value] ?? value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function paymentMethodFor(value: string | null | undefined) { if (!value) return 'Forma de pagamento não informada'; const labels: Record<string, string> = { PIX: 'Pix', BOLETO: 'Boleto bancário', CREDIT_CARD: 'Cartão de crédito', DEBIT_CARD: 'Cartão de débito', CUSTOMER_CHOOSES: 'Cliente escolhe', RECURRENT: 'Recorrente', RECORRENTE: 'Recorrente' }; return labels[value] ?? labelFor(value); }
function notificationLabel(event: string) { const labels: Record<string, string> = { PAYMENT_CREATED: 'Nova cobrança criada', PAYMENT_UPDATED: 'Cobrança alterada', PAYMENT_DUEDATE_WARNING: 'Lembrete de vencimento', SEND_LINHA_DIGITAVEL: 'Linha digitável', PAYMENT_OVERDUE: 'Cobrança em atraso', PAYMENT_RECEIVED: 'Pagamento confirmado' }; return labels[event] ?? 'Aviso financeiro'; }
function notificationSchedule(preference: StudentNotifications['preferences'][number]) { if (preference.event === 'PAYMENT_DUEDATE_WARNING' && preference.scheduleOffset > 0) return `${preference.scheduleOffset} dias antes do vencimento`; if (preference.event === 'PAYMENT_OVERDUE' && preference.scheduleOffset > 0) return `A cada ${preference.scheduleOffset} dias após o vencimento`; return 'No momento adequado'; }

const styles = StyleSheet.create({
  screen: { gap: spacing.lg, paddingBottom: 128 },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headerButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1 },
  content: { gap: spacing.lg },
  identityCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, padding: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.surfaceNeutral },
  identityCopy: { flex: 1, gap: spacing.xs },
  avatarWrap: { position: 'relative' },
  avatarEdit: { position: 'absolute', right: -4, bottom: -2, width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.brandSoft, borderWidth: 2, borderColor: colors.surface },
  flexCopy: { flex: 1, gap: spacing.xs },
  card: { gap: spacing.lg, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  subsection: { gap: spacing.md },
  responsibleBlock: { gap: spacing.lg },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  statusMarker: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  sectionBody: { gap: spacing.lg, paddingTop: spacing.xs },
  statusBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
  statusDot: { width: 7, height: 7, borderRadius: radius.pill },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: spacing.lg },
  infoItem: { width: '46%', minWidth: 0, gap: spacing.xs },
  booleanList: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  booleanRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  longValue: { gap: spacing.xs },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  notificationNotice: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface },
  notificationList: { gap: spacing.md },
  notificationRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  channelDots: { flexDirection: 'row', gap: spacing.xs },
  channelDot: { minWidth: 26, height: 26, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  channelDotActive: { backgroundColor: colors.brandSoft, borderColor: colors.brandSoft },
  channelText: { color: colors.inkSubtle },
  channelTextActive: { color: colors.brand },
  outlineButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.brand },
  outlineText: { color: colors.brand },
  chevronClosed: { transform: [{ rotate: '-90deg' }] },
  pressed: { opacity: 0.78 },
  skeletonCard: { gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
});

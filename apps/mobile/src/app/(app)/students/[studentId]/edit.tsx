import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Switch, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeftIcon, PencilSquareIcon } from 'react-native-heroicons/outline';

import { ErrorState } from '@/components/feedback/ErrorState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { DateField, DatePickerSheet } from '@/components/forms/DateField';
import { SelectField } from '@/components/forms/SelectField';
import { Screen } from '@/components/layout/Screen';
import { AppText } from '@/components/primitives/AppText';
import { Button } from '@/components/primitives/Button';
import { TextField } from '@/components/primitives/TextField';
import { studentService } from '@/features/students/services/student-service';
import { StudentAvatar } from '@/features/students/components/StudentAvatar';
import type { StudentDetail } from '@/features/students/types/student';
import { colors, radius, spacing } from '@/theme/tokens';

const genderOptions = [
  { value: 'MASCULINO', label: 'Masculino' }, { value: 'FEMININO', label: 'Feminino' },
  { value: 'NAO_BINARIO', label: 'Não binário' }, { value: 'OUTRO', label: 'Outro' }, { value: 'PREFERE_NAO_INFORMAR', label: 'Prefere não informar' },
];

export default function StudentEditScreen() {
  const { studentId } = useLocalSearchParams<{ studentId?: string; focus?: string }>();
  const [student, setStudent] = useState<StudentDetail | null>(null);
  const [form, setForm] = useState<StudentForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [photoSaving, setPhotoSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [birthDatePickerVisible, setBirthDatePickerVisible] = useState(false);
  const [birthDatePickerValue, setBirthDatePickerValue] = useState(() => new Date(2000, 0, 1, 12));

  const load = useCallback(async () => {
    if (!studentId) { setError('Aluno não encontrado.'); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const response = await studentService.getStudent(studentId);
      setStudent(response.student);
      setForm(toForm(response.student));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os dados.');
    } finally { setLoading(false); }
  }, [studentId]);

  useEffect(() => { void load(); }, [load]);

  const update = useCallback(<K extends keyof StudentForm>(key: K, value: StudentForm[K]) => {
    setForm((current) => current ? { ...current, [key]: value } : current);
  }, []);

  async function save() {
    if (!studentId || !form || saving) return;
    if (form.name.trim().length < 2) { Alert.alert('Confira os dados', 'Informe o nome completo do aluno.'); return; }
    setSaving(true);
    try {
      await studentService.updateStudent(studentId, toPayload(form));
      Alert.alert('Dados salvos', 'As informações do aluno foram atualizadas.', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (saveError) {
      Alert.alert('Não foi possível salvar', saveError instanceof Error ? saveError.message : 'Confira os campos e tente novamente.');
    } finally { setSaving(false); }
  }

  async function choosePhoto() {
    if (!studentId || photoSaving) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { Alert.alert('Permissão necessária', 'Permita o acesso às fotos para alterar a imagem do aluno.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.85 });
    if (result.canceled || !result.assets[0]) return;
    setPhotoSaving(true);
    try {
      const processed = await manipulateAsync(result.assets[0].uri, [{ resize: { width: 512, height: 512 } }], { compress: 0.85, format: SaveFormat.JPEG });
      const dataUrl = await uriToDataUrl(processed.uri);
      await studentService.updateStudent(studentId, { foto: dataUrl });
      await load();
    } catch (photoError) {
      Alert.alert('Não foi possível atualizar a foto', photoError instanceof Error ? photoError.message : 'Tente novamente.');
    } finally { setPhotoSaving(false); }
  }

  function openBirthDatePicker() {
    if (!form) return;
    const date = new Date(form.birthDate);
    setBirthDatePickerValue(Number.isNaN(date.getTime()) ? new Date(2000, 0, 1, 12) : date);
    setBirthDatePickerVisible(true);
  }

  function onBirthDateChange(event: DateTimePickerEvent, date?: Date) {
    if (Platform.OS === 'android') setBirthDatePickerVisible(false);
    if (date) {
      setBirthDatePickerValue(date);
      if (Platform.OS === 'android') update('birthDate', date.toISOString());
    }
  }

  if (error || (!loading && !student)) return <Screen backgroundColor={colors.surface} style={styles.screen}><Header /><ErrorState title="Não foi possível carregar" message={error ?? 'Aluno não encontrado.'} actionLabel="Tentar novamente" onAction={() => void load()} /></Screen>;
  if (loading || !form || !student) return <Screen backgroundColor={colors.surface} style={styles.screen}><Header /><View style={styles.form}><Skeleton width="48%" height={28} /><Skeleton width="100%" height={86} radius={radius.lg} />{[0, 1, 2, 3, 4].map((item) => <View key={item} style={styles.skeletonGroup}><Skeleton width="38%" height={16} /><Skeleton width="100%" height={58} radius={radius.md} /></View>)}</View></Screen>;

  return (
    <Screen scroll keyboard backgroundColor={colors.surface} style={styles.screen}>
      <Header />
      <View style={styles.form}>
        <AppText variant="display" weight="medium">Editar dados</AppText>
        <FormSection title="Foto do aluno">
          <View style={styles.photoEditRow}><StudentAvatar name={form.name} photo={student.photo} size={76} /><View style={styles.flexCopy}><AppText weight="medium">Atualize a foto quando precisar.</AppText><AppText variant="small" tone="muted">Use uma imagem quadrada para melhor resultado.</AppText></View><Pressable accessibilityRole="button" accessibilityLabel="Escolher nova foto do aluno" disabled={photoSaving} onPress={() => void choosePhoto()} style={styles.photoButton}><PencilSquareIcon color={colors.brand} size={20} strokeWidth={1.8} /></Pressable></View>
        </FormSection>

        <FormSection title="Dados pessoais">
          <TextField label="Nome completo" value={form.name} onChangeText={(value) => update('name', value)} autoCapitalize="words" />
          <TextField label="Nome social" value={form.socialName} onChangeText={(value) => update('socialName', value)} autoCapitalize="words" />
          <TextField label="CPF" value={form.cpf} onChangeText={(value) => update('cpf', value)} keyboardType="number-pad" />
          <TextField label="E-mail" value={form.email} onChangeText={(value) => update('email', value)} keyboardType="email-address" autoCapitalize="none" />
          <TextField label="Telefone" value={form.phone} onChangeText={(value) => update('phone', value)} keyboardType="phone-pad" />
          <DateField label="Data de nascimento" value={formatDateBR(form.birthDate)} onPress={openBirthDatePicker} />
          <SelectField label="Gênero" value={genderOptions.find((item) => item.value === form.gender)?.label ?? 'Selecione'} selectedValue={form.gender} options={genderOptions} onValueChange={(value) => update('gender', value)} />
        </FormSection>

        <FormSection title="Informações complementares">
          <TextField label="Modalidade principal" value={form.mainModality} onChangeText={(value) => update('mainModality', value)} />
          <TextField label="Nível" value={form.level} onChangeText={(value) => update('level', value)} />
          <TextField label="Origem do cadastro" value={form.registrationOrigin} onChangeText={(value) => update('registrationOrigin', value)} />
          <TextField label="Código interno" value={form.internalCode} onChangeText={(value) => update('internalCode', value)} />
          <TextField label="Tags" value={form.tags} onChangeText={(value) => update('tags', value)} placeholder="Separe as tags por vírgula" />
          <TextField label="Bolsa ou desconto (%)" value={form.discountPercent} onChangeText={(value) => update('discountPercent', value.replace(/[^0-9,]/g, ''))} keyboardType="decimal-pad" />
          <TextField label="Tamanho de camiseta" value={form.shirtSize} onChangeText={(value) => update('shirtSize', value)} />
          <TextField label="Tamanho de calçado" value={form.shoeSize} onChangeText={(value) => update('shoeSize', value)} keyboardType="number-pad" />
          <TextField label="Alergias" value={form.allergies} onChangeText={(value) => update('allergies', value)} multiline />
          <TextField label="Restrições médicas" value={form.medicalRestrictions} onChangeText={(value) => update('medicalRestrictions', value)} multiline />
          <TextField label="Observações" value={form.notes} onChangeText={(value) => update('notes', value)} multiline />
          <BooleanField label="Isento da taxa de matrícula" value={form.registrationFeeExempt} onChange={(value) => update('registrationFeeExempt', value)} />
          <BooleanField label="Consentimento de imagem" value={form.imageConsent} onChange={(value) => update('imageConsent', value)} />
          <BooleanField label="Comunicações permitidas" value={form.communicationConsent} onChange={(value) => update('communicationConsent', value)} />
          <BooleanField label="Comunicações promocionais" value={form.marketingConsent} onChange={(value) => update('marketingConsent', value)} />
        </FormSection>

        <FormSection title="Endereço">
          <TextField label="CEP" value={form.addressCep} onChangeText={(value) => update('addressCep', value)} keyboardType="number-pad" />
          <TextField label="Rua" value={form.addressStreet} onChangeText={(value) => update('addressStreet', value)} />
          <View style={styles.twoColumns}><View style={styles.column}><TextField label="Número" value={form.addressNumber} onChangeText={(value) => update('addressNumber', value)} /></View><View style={styles.column}><TextField label="UF" value={form.addressState} onChangeText={(value) => update('addressState', value.toUpperCase().slice(0, 2))} autoCapitalize="characters" /></View></View>
          <TextField label="Complemento" value={form.addressComplement} onChangeText={(value) => update('addressComplement', value)} />
          <TextField label="Bairro" value={form.addressNeighborhood} onChangeText={(value) => update('addressNeighborhood', value)} />
          <TextField label="Cidade" value={form.addressCity} onChangeText={(value) => update('addressCity', value)} />
        </FormSection>

        <FormSection title="Contato de emergência">
          <TextField label="Nome" value={form.emergencyName} onChangeText={(value) => update('emergencyName', value)} />
          <TextField label="Telefone" value={form.emergencyPhone} onChangeText={(value) => update('emergencyPhone', value)} keyboardType="phone-pad" />
        </FormSection>

        {student.responsible ? <FormSection title="Responsável principal"><TextField label="Nome" value={form.responsibleName} onChangeText={(value) => update('responsibleName', value)} /><TextField label="CPF" value={form.responsibleCpf} onChangeText={(value) => update('responsibleCpf', value)} keyboardType="number-pad" /><TextField label="E-mail" value={form.responsibleEmail} onChangeText={(value) => update('responsibleEmail', value)} keyboardType="email-address" autoCapitalize="none" /><TextField label="Telefone" value={form.responsiblePhone} onChangeText={(value) => update('responsiblePhone', value)} keyboardType="phone-pad" /><BooleanField label="Responsável financeiro" value={form.responsibleFinancial} onChange={(value) => update('responsibleFinancial', value)} /><BooleanField label="Comunicações permitidas" value={form.responsibleCommunicationConsent} onChange={(value) => update('responsibleCommunicationConsent', value)} /><BooleanField label="Comunicações promocionais" value={form.responsibleMarketingConsent} onChange={(value) => update('responsibleMarketingConsent', value)} /><TextField label="CEP" value={form.responsibleCep} onChangeText={(value) => update('responsibleCep', value)} keyboardType="number-pad" /><TextField label="Rua" value={form.responsibleStreet} onChangeText={(value) => update('responsibleStreet', value)} /><View style={styles.twoColumns}><View style={styles.column}><TextField label="Número" value={form.responsibleNumber} onChangeText={(value) => update('responsibleNumber', value)} /></View><View style={styles.column}><TextField label="UF" value={form.responsibleState} onChangeText={(value) => update('responsibleState', value.toUpperCase().slice(0, 2))} autoCapitalize="characters" /></View></View><TextField label="Complemento" value={form.responsibleComplement} onChangeText={(value) => update('responsibleComplement', value)} /><TextField label="Bairro" value={form.responsibleNeighborhood} onChangeText={(value) => update('responsibleNeighborhood', value)} /><TextField label="Cidade" value={form.responsibleCity} onChangeText={(value) => update('responsibleCity', value)} /></FormSection> : null}

        <Button title="Salvar alterações" loading={saving} onPress={() => void save()} />
      </View>
      {Platform.OS === 'android' && birthDatePickerVisible ? <DateTimePicker value={birthDatePickerValue} mode="date" display="default" maximumDate={new Date()} onChange={onBirthDateChange} /> : null}
      {Platform.OS === 'ios' ? <DatePickerSheet visible={birthDatePickerVisible} selectedDate={birthDatePickerValue} maximumDate={new Date()} onDateChange={(_event, date) => { if (date) setBirthDatePickerValue(date); }} onClose={() => setBirthDatePickerVisible(false)} onConfirm={() => { update('birthDate', birthDatePickerValue.toISOString()); setBirthDatePickerVisible(false); }} /> : null}
    </Screen>
  );
}

function Header() { return <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Voltar para detalhes do aluno" hitSlop={10} onPress={() => router.back()} style={styles.headerButton}><ArrowLeftIcon color={colors.ink} size={25} strokeWidth={1.8} /></Pressable><AppText variant="heading" weight="medium">Editar aluno</AppText><View style={styles.headerSpacer} /></View>; }
function FormSection({ title, children }: { title: string; children: ReactNode }) { return <View style={styles.formSection}><AppText variant="subheading" weight="medium">{title}</AppText><View style={styles.sectionFields}>{children}</View></View>; }
function BooleanField({ label, value, onChange }: { label: string; value: boolean; onChange: (_nextValue: boolean) => void }) { return <View style={styles.booleanField}><AppText style={styles.flexCopy}>{label}</AppText><Switch accessibilityLabel={label} value={value} onValueChange={onChange} trackColor={{ false: colors.border, true: colors.brandSoft }} thumbColor={value ? colors.brand : colors.surface} /></View>; }

type StudentForm = {
  name: string; socialName: string; cpf: string; email: string; phone: string; birthDate: string; gender: string; mainModality: string; level: string; registrationOrigin: string; internalCode: string; tags: string; discountPercent: string; shirtSize: string; shoeSize: string; allergies: string; medicalRestrictions: string; notes: string; registrationFeeExempt: boolean; imageConsent: boolean; communicationConsent: boolean; marketingConsent: boolean; addressCep: string; addressStreet: string; addressNumber: string; addressComplement: string; addressNeighborhood: string; addressCity: string; addressState: string; emergencyName: string; emergencyPhone: string; responsibleName: string; responsibleCpf: string; responsibleEmail: string; responsiblePhone: string; responsibleFinancial: boolean; responsibleCommunicationConsent: boolean; responsibleMarketingConsent: boolean; responsibleCep: string; responsibleStreet: string; responsibleNumber: string; responsibleComplement: string; responsibleNeighborhood: string; responsibleCity: string; responsibleState: string;
};

function toForm(student: StudentDetail): StudentForm { const address = student.address; const responsible = student.responsible; const responsibleAddress = responsible?.address; return { name: student.name, socialName: student.socialName ?? '', cpf: student.cpf ?? '', email: student.email ?? '', phone: student.phone ?? '', birthDate: student.birthDate ?? '', gender: student.gender ?? '', mainModality: student.mainModality ?? '', level: student.level ?? '', registrationOrigin: student.registrationOrigin ?? '', internalCode: student.internalCode ?? '', tags: student.tags.join(', '), discountPercent: student.discountPercent === null ? '' : String(student.discountPercent).replace('.', ','), shirtSize: student.shirtSize ?? '', shoeSize: student.shoeSize ?? '', allergies: student.allergies ?? '', medicalRestrictions: student.medicalRestrictions ?? '', notes: student.notes ?? '', registrationFeeExempt: student.registrationFeeExempt, imageConsent: student.imageConsent, communicationConsent: student.communicationConsent, marketingConsent: student.marketingConsent, addressCep: address?.cep ?? '', addressStreet: address?.street ?? '', addressNumber: address?.number ?? '', addressComplement: address?.complement ?? '', addressNeighborhood: address?.neighborhood ?? '', addressCity: address?.city ?? '', addressState: address?.state ?? '', emergencyName: student.emergencyContactName ?? '', emergencyPhone: student.emergencyContactPhone ?? '', responsibleName: responsible?.name ?? '', responsibleCpf: responsible?.cpf ?? '', responsibleEmail: responsible?.email ?? '', responsiblePhone: responsible?.phone ?? '', responsibleFinancial: responsible?.financial ?? false, responsibleCommunicationConsent: responsible?.communicationConsent ?? false, responsibleMarketingConsent: responsible?.marketingConsent ?? false, responsibleCep: responsibleAddress?.cep ?? '', responsibleStreet: responsibleAddress?.street ?? '', responsibleNumber: responsibleAddress?.number ?? '', responsibleComplement: responsibleAddress?.complement ?? '', responsibleNeighborhood: responsibleAddress?.neighborhood ?? '', responsibleCity: responsibleAddress?.city ?? '', responsibleState: responsibleAddress?.state ?? '' }; }
function toPayload(form: StudentForm) { const discount = Number(form.discountPercent.replace(',', '.')); return { nome: form.name.trim(), nomeSocial: form.socialName.trim() || undefined, cpf: form.cpf, email: form.email, telefone: form.phone, dataNasc: form.birthDate, genero: form.gender || undefined, modalidadePrincipal: form.mainModality, nivel: form.level, origemCadastro: form.registrationOrigin, codigoInterno: form.internalCode, tags: form.tags.split(',').map((value) => value.trim()).filter(Boolean), bolsaDescontoPercent: Number.isFinite(discount) ? discount : undefined, tamanhoCamiseta: form.shirtSize, tamanhoCalcado: form.shoeSize, alergias: form.allergies, restricoesMedicas: form.medicalRestrictions, observacao: form.notes, isentoTaxaMatricula: form.registrationFeeExempt, consentimentoImagem: form.imageConsent, consentimentoComunicacoes: form.communicationConsent, consentimentoMarketing: form.marketingConsent, contatoEmergenciaNome: form.emergencyName, contatoEmergenciaTelefone: form.emergencyPhone, endereco: { cep: form.addressCep, logradouro: form.addressStreet, numero: form.addressNumber, complemento: form.addressComplement, bairro: form.addressNeighborhood, cidade: form.addressCity, uf: form.addressState }, ...(form.responsibleName ? { responsavel: { nome: form.responsibleName, cpf: form.responsibleCpf, email: form.responsibleEmail, telefone: form.responsiblePhone, financeiro: form.responsibleFinancial, consentimentoComunicacoes: form.responsibleCommunicationConsent, consentimentoMarketing: form.responsibleMarketingConsent, endereco: { cep: form.responsibleCep, logradouro: form.responsibleStreet, numero: form.responsibleNumber, complemento: form.responsibleComplement, bairro: form.responsibleNeighborhood, cidade: form.responsibleCity, uf: form.responsibleState } } } : {}) }; }
function formatDateBR(value: string) { if (!value) return 'Não informado'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Não informado' : date.toLocaleDateString('pt-BR'); }
async function uriToDataUrl(uri: string) { const blob = await (await fetch(uri)).blob(); return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Não foi possível ler a imagem.')); reader.readAsDataURL(blob); }); }

const styles = StyleSheet.create({
  screen: { gap: spacing.xl, paddingBottom: spacing['2xl'] }, header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.md }, headerButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }, headerSpacer: { flex: 1 }, form: { gap: spacing['2xl'] }, formSection: { gap: spacing.lg }, sectionFields: { gap: spacing.lg }, photoEditRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral }, flexCopy: { flex: 1, gap: spacing.xs }, photoButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.brandSoft }, twoColumns: { flexDirection: 'row', gap: spacing.md }, column: { flex: 1 }, booleanField: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.md }, skeletonGroup: { gap: spacing.sm },
});

import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeftIcon } from 'react-native-heroicons/outline';

import { ErrorState } from '@/components/feedback/ErrorState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { Screen } from '@/components/layout/Screen';
import { AppText } from '@/components/primitives/AppText';
import { Button } from '@/components/primitives/Button';
import { TextField } from '@/components/primitives/TextField';
import { responsibleService } from '@/features/responsibles/services/responsible-service';
import type { ResponsibleDetail } from '@/features/responsibles/types/responsible';
import { colors, radius, spacing } from '@/theme/tokens';

type ResponsibleForm = { name: string; cpf: string; email: string; phone: string; financial: boolean; communicationConsent: boolean; marketingConsent: boolean; cep: string; street: string; number: string; complement: string; neighborhood: string; city: string; state: string };

export default function ResponsibleEditScreen() {
  const { responsibleId } = useLocalSearchParams<{ responsibleId?: string }>();
  const [form, setForm] = useState<ResponsibleForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!responsibleId) { setError('Responsável não encontrado.'); setLoading(false); return; }
    setLoading(true); setError(null);
    try { setForm(toForm((await responsibleService.getResponsible(responsibleId)).responsible)); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os dados.'); }
    finally { setLoading(false); }
  }, [responsibleId]);
  useEffect(() => { void load(); }, [load]);

  const update = useCallback(<K extends keyof ResponsibleForm>(key: K, value: ResponsibleForm[K]) => setForm((current) => current ? { ...current, [key]: value } : current), []);

  async function save() {
    if (!responsibleId || !form || saving) return;
    if (form.name.trim().length < 3) { Alert.alert('Confira os dados', 'Informe o nome completo do responsável.'); return; }
    setSaving(true);
    try { await responsibleService.updateResponsible(responsibleId, toPayload(form)); Alert.alert('Dados salvos', 'As informações do responsável foram atualizadas.', [{ text: 'OK', onPress: () => router.back() }]); }
    catch (saveError) { Alert.alert('Não foi possível salvar', saveError instanceof Error ? saveError.message : 'Confira os campos e tente novamente.'); }
    finally { setSaving(false); }
  }

  return <Screen scroll keyboard backgroundColor={colors.surface} style={styles.screen}><Header />{loading ? <EditSkeleton /> : null}{!loading && error ? <ErrorState title="Não foi possível carregar" message={error} actionLabel="Tentar novamente" onAction={() => void load()} /> : null}{!loading && !error && form ? <View style={styles.form}><AppText variant="display" weight="medium">Editar dados</AppText><FormSection title="Dados do responsável"><TextField label="Nome completo" value={form.name} onChangeText={(value) => update('name', value)} autoCapitalize="words" /><TextField label="CPF" value={form.cpf} onChangeText={(value) => update('cpf', value)} keyboardType="number-pad" /><TextField label="E-mail" value={form.email} onChangeText={(value) => update('email', value)} keyboardType="email-address" autoCapitalize="none" /><TextField label="Telefone" value={form.phone} onChangeText={(value) => update('phone', value)} keyboardType="phone-pad" /><BooleanField label="Responsável financeiro" currentValue={form.financial} onChange={(value) => update('financial', value)} /><BooleanField label="Comunicações permitidas" currentValue={form.communicationConsent} onChange={(value) => update('communicationConsent', value)} /><BooleanField label="Comunicações promocionais" currentValue={form.marketingConsent} onChange={(value) => update('marketingConsent', value)} /></FormSection><FormSection title="Endereço"><TextField label="CEP" value={form.cep} onChangeText={(value) => update('cep', value)} keyboardType="number-pad" /><TextField label="Logradouro" value={form.street} onChangeText={(value) => update('street', value)} /><View style={styles.twoColumns}><View style={styles.column}><TextField label="Número" value={form.number} onChangeText={(value) => update('number', value)} /></View><View style={styles.column}><TextField label="UF" value={form.state} onChangeText={(value) => update('state', value.toUpperCase().slice(0, 2))} autoCapitalize="characters" /></View></View><TextField label="Complemento" value={form.complement} onChangeText={(value) => update('complement', value)} /><TextField label="Bairro" value={form.neighborhood} onChangeText={(value) => update('neighborhood', value)} /><TextField label="Cidade" value={form.city} onChangeText={(value) => update('city', value)} /></FormSection><Button title="Salvar alterações" loading={saving} onPress={() => void save()} /></View> : null}</Screen>;
}

function Header() { return <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Voltar para detalhes do responsável" hitSlop={10} onPress={() => router.back()} style={styles.headerButton}><ArrowLeftIcon color={colors.ink} size={25} strokeWidth={1.8} /></Pressable><AppText variant="heading" weight="medium">Editar responsável</AppText><View style={styles.headerSpacer} /></View>; }
function FormSection({ title, children }: { title: string; children: React.ReactNode }) { return <View style={styles.formSection}><AppText variant="subheading" weight="medium">{title}</AppText><View style={styles.sectionFields}>{children}</View></View>; }
function BooleanField({ label, currentValue, onChange }: { label: string; currentValue: boolean; onChange: (_nextValue: boolean) => void }) { return <View style={styles.booleanField}><AppText style={styles.flexCopy}>{label}</AppText><Switch accessibilityLabel={label} value={currentValue} onValueChange={onChange} trackColor={{ false: colors.border, true: colors.brandSoft }} thumbColor={currentValue ? colors.brand : colors.surface} /></View>; }
function EditSkeleton() { return <View style={styles.form} accessibilityLabel="Carregando edição do responsável"><Skeleton width="48%" height={28} />{[0, 1, 2].map((item) => <View key={item} style={styles.skeletonGroup}><Skeleton width="42%" height={16} /><Skeleton width="100%" height={58} radius={radius.md} /></View>)}</View>; }
function toForm(responsible: ResponsibleDetail): ResponsibleForm { const address = responsible.address; return { name: responsible.name, cpf: responsible.cpf, email: responsible.email, phone: responsible.phone, financial: responsible.financial, communicationConsent: responsible.communicationConsent, marketingConsent: responsible.marketingConsent, cep: address?.cep ?? '', street: address?.street ?? '', number: address?.number ?? '', complement: address?.complement ?? '', neighborhood: address?.neighborhood ?? '', city: address?.city ?? '', state: address?.state ?? '' }; }
function toPayload(form: ResponsibleForm) { return { nome: form.name.trim(), cpf: form.cpf, email: form.email.trim(), telefone: form.phone, financeiro: form.financial, consentimentoComunicacoes: form.communicationConsent, consentimentoMarketing: form.marketingConsent, endereco: { cep: form.cep, logradouro: form.street, numero: form.number, complemento: form.complement, bairro: form.neighborhood, cidade: form.city, uf: form.state } }; }

const styles = StyleSheet.create({ screen: { gap: spacing.xl, paddingBottom: spacing['2xl'] }, header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.md }, headerButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }, headerSpacer: { flex: 1 }, form: { gap: spacing['2xl'] }, formSection: { gap: spacing.lg }, sectionFields: { gap: spacing.lg }, twoColumns: { flexDirection: 'row', gap: spacing.md }, column: { flex: 1 }, booleanField: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.md }, flexCopy: { flex: 1 }, skeletonGroup: { gap: spacing.sm } });

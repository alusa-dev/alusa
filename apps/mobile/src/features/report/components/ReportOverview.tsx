import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/primitives/AppText';
import { colors, radius, spacing } from '@/theme/tokens';
import type { ReportHighlight, ReportOccupancyItem, ReportResponse } from '../types/report';

export function ReportOverview({ data }: { data: ReportResponse }) {
  return (
    <View style={styles.container}>
      <SummaryCard data={data} />
      <HealthCard data={data} />
      <ReceivablesCard data={data} />
      <TrendCard items={data.series} />
      <HighlightsCard highlights={data.highlights} />
      <AcademicContextCard data={data} />
      <OccupancyCard items={data.classOccupancy} />
      <DataQualityNotice data={data} />
      <AppText variant="tiny" tone="subtle" style={styles.updatedAt}>
        Atualizado em {formatDateTime(data.generatedAt, data.timeZone)}
      </AppText>
    </View>
  );
}

function SummaryCard({ data }: { data: ReportResponse }) {
  const { summary } = data;
  return (
    <View style={styles.card}>
      <View style={styles.cardHeading}>
        <AppText variant="subheading" weight="medium">Indicadores principais</AppText>
        <AppText variant="small" tone="muted">Valores do período selecionado</AppText>
      </View>
      <View style={styles.metricGrid}>
        <Metric label="Recebido" value={formatCurrency(summary.received)} tone={colors.success} />
        <Metric label="A receber" value={formatCurrency(summary.receivable)} tone={colors.brand} />
        <Metric label="Em atraso" value={formatCurrency(summary.overdue)} tone={colors.danger} />
        <Metric label="Cobranças" value={String(summary.chargeCount)} tone={colors.ink} />
      </View>
    </View>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <View style={styles.metric}>
      <AppText variant="small" tone="muted">{label}</AppText>
      <AppText variant="heading" weight="medium" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ color: tone }}>
        {value}
      </AppText>
    </View>
  );
}

function HealthCard({ data }: { data: ReportResponse }) {
  const tone = healthTone(data.health.level);
  const segmentCount = 24;
  const filledSegments = data.health.score === null
    ? 0
    : Math.round((data.health.score / 100) * segmentCount);

  return (
    <View style={styles.card}>
      <View style={styles.healthHeader}>
        <View style={styles.healthHeading}>
          <AppText variant="subheading" weight="medium">Score de saúde do negócio</AppText>
          <AppText variant="small" tone="muted">Estado operacional atual da escola.</AppText>
        </View>
        <View style={[styles.diagnosticBadge, { backgroundColor: `${tone}18` }]}>
          <AppText variant="tiny" weight="medium" style={{ color: tone }}>Diagnóstico</AppText>
        </View>
      </View>
      <View style={styles.healthBody}>
        <View style={styles.healthScoreRow}>
          <AppText weight="medium">{data.health.label}</AppText>
          {data.health.score !== null ? (
            <AppText weight="medium" style={styles.healthScore}>
              {data.health.score} <AppText variant="tiny" weight="medium" tone="muted">/ 100</AppText>
            </AppText>
          ) : null}
        </View>
        <View
          style={styles.scoreSegments}
          accessibilityRole="image"
          accessibilityLabel={data.health.score === null ? 'Score indisponível' : `Score de saúde do negócio: ${data.health.score} de 100`}
        >
          {Array.from({ length: segmentCount }, (_, index) => (
            <View
              key={index}
              style={[
                styles.scoreSegment,
                index < filledSegments
                  ? { backgroundColor: scoreSegmentColor(index, segmentCount) }
                  : styles.scoreSegmentEmpty,
              ]}
            />
          ))}
        </View>
        <View style={styles.healthDescription}>
          <AppText variant="small" tone="muted">{data.health.description}</AppText>
        </View>
      </View>
    </View>
  );
}

function ReceivablesCard({ data }: { data: ReportResponse }) {
  const { received, receivable, overdue } = data.summary;
  const total = Math.max(received + receivable + overdue, 0);
  return (
    <View style={styles.card}>
      <View style={styles.cardHeading}>
        <AppText variant="subheading" weight="medium">Situação dos recebimentos</AppText>
        <AppText variant="small" tone="muted">Como os valores estão distribuídos</AppText>
      </View>
      <View style={styles.compositionTrack} accessibilityLabel="Distribuição dos recebimentos">
        <View style={[styles.compositionSegment, { flex: total > 0 ? received : 1, backgroundColor: colors.success }]} />
        <View style={[styles.compositionSegment, { flex: total > 0 ? receivable : 0.001, backgroundColor: colors.brandSoft }]} />
        <View style={[styles.compositionSegment, { flex: total > 0 ? overdue : 0.001, backgroundColor: colors.danger }]} />
      </View>
      <View style={styles.valueList}>
        <ValueRow label="Recebido" value={formatCurrency(received)} tone={colors.success} />
        <ValueRow label="A receber" value={formatCurrency(receivable)} tone={colors.brand} />
        <ValueRow label="Em atraso" value={formatCurrency(overdue)} tone={colors.danger} />
      </View>
    </View>
  );
}

function TrendCard({ items }: { items: ReportResponse['series'] }) {
  const visibleItems = items.slice(-6);
  const maximum = Math.max(...visibleItems.map((item) => Math.max(item.charged, item.received)), 0);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeading}>
        <AppText variant="subheading" weight="medium">Evolução dos recebimentos</AppText>
        <AppText variant="small" tone="muted">Comparação entre o que foi cobrado e recebido</AppText>
      </View>
      {visibleItems.length === 0 ? (
        <AppText tone="muted">Ainda não há movimentações para comparar.</AppText>
      ) : (
        <View style={styles.trendList}>
          <View style={styles.trendLegend}>
            <LegendItem label="Cobrado" color={colors.brandSoft} />
            <LegendItem label="Recebido" color={colors.success} />
          </View>
          {visibleItems.map((item) => (
            <View key={item.key} style={styles.trendRow}>
              <AppText variant="tiny" tone="muted" numberOfLines={1} style={styles.trendLabel}>{item.label}</AppText>
              <View style={styles.trendBars}>
                <View style={styles.trendBarTrack}>
                  <View style={[styles.trendBar, { width: `${barWidth(item.charged, maximum)}%`, backgroundColor: colors.brandSoft }]} />
                </View>
                <View style={styles.trendBarTrack}>
                  <View style={[styles.trendBar, { width: `${barWidth(item.received, maximum)}%`, backgroundColor: colors.success }]} />
                </View>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function LegendItem({ label, color }: { label: string; color: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <AppText variant="tiny" tone="muted">{label}</AppText>
    </View>
  );
}

function ValueRow({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <View style={styles.valueRow}>
      <View style={styles.valueLabel}>
        <View style={[styles.statusDot, { backgroundColor: tone }]} />
        <AppText tone="muted">{label}</AppText>
      </View>
      <AppText weight="medium" style={{ color: tone }}>{value}</AppText>
    </View>
  );
}

function HighlightsCard({ highlights }: { highlights: ReportHighlight[] }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeading}>
        <AppText variant="subheading" weight="medium">Pontos de atenção</AppText>
        <AppText variant="small" tone="muted">Sinais para acompanhar neste período</AppText>
      </View>
      <View style={styles.highlightList}>
        {highlights.map((highlight) => (
          <View key={`${highlight.title}:${highlight.value}`} style={styles.highlightRow}>
            <View style={[styles.statusDot, { backgroundColor: highlightTone(highlight.tone) }]} />
            <View style={styles.highlightCopy}>
              <AppText weight="medium" numberOfLines={2}>{highlight.title}</AppText>
              <AppText variant="small" tone="muted" numberOfLines={2}>{highlight.description}</AppText>
            </View>
            <AppText variant="small" weight="medium" numberOfLines={2} style={styles.highlightValue}>{highlight.value}</AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

function AcademicContextCard({ data }: { data: ReportResponse }) {
  const { enrollmentHealth } = data;
  return (
    <View style={styles.card}>
      <View style={styles.cardHeading}>
        <AppText variant="subheading" weight="medium">Contexto educacional</AppText>
        <AppText variant="small" tone="muted">Movimento das matrículas</AppText>
      </View>
      <View style={styles.valueList}>
        <ValueRow label="Matrículas ativas" value={String(enrollmentHealth.activeEnrollments)} tone={colors.brand} />
        <ValueRow label="Novas matrículas" value={String(enrollmentHealth.enrollmentsInPeriod)} tone={colors.success} />
        <ValueRow label="Cancelamentos" value={String(enrollmentHealth.cancellationsInPeriod)} tone={enrollmentHealth.cancellationsInPeriod > 0 ? colors.warning : colors.success} />
        <ValueRow label="Retenção" value={formatPercentage(enrollmentHealth.retentionRate)} tone={colors.brand} />
      </View>
    </View>
  );
}

function OccupancyCard({ items }: { items: ReportOccupancyItem[] }) {
  const totalCapacity = items.reduce((total, item) => total + item.capacity, 0);
  const totalOccupied = items.reduce((total, item) => total + item.occupiedSeats, 0);
  const average = totalCapacity > 0 ? (totalOccupied / totalCapacity) * 100 : 0;
  return (
    <View style={styles.card}>
      <View style={styles.cardHeading}>
        <AppText variant="subheading" weight="medium">Ocupação das turmas</AppText>
        <AppText variant="small" tone="muted">Vagas ocupadas nas turmas ativas</AppText>
      </View>
      {items.length === 0 ? (
        <AppText tone="muted">Nenhuma turma ativa encontrada.</AppText>
      ) : (
        <View style={styles.occupancyList}>
          {items.map((item) => <OccupancyRow key={item.id} item={item} />)}
          <AppText variant="small" tone="muted" style={styles.occupancySummary}>
            Ocupação média: <AppText variant="small" weight="medium">{formatPercentage(average)}</AppText>
          </AppText>
        </View>
      )}
    </View>
  );
}

function OccupancyRow({ item }: { item: ReportOccupancyItem }) {
  return (
    <View style={styles.occupancyRow}>
      <View style={styles.occupancyHeader}>
        <AppText variant="small" weight="medium" numberOfLines={1} style={styles.occupancyName}>{item.name}</AppText>
        <AppText variant="tiny" tone="muted">{item.occupiedSeats}/{item.capacity}</AppText>
      </View>
      <View style={styles.occupancyTrack}>
        <View style={[styles.occupancyProgress, { width: `${Math.min(100, item.occupancyRate)}%` }]} />
      </View>
    </View>
  );
}

function DataQualityNotice({ data }: { data: ReportResponse }) {
  if (data.dataQuality.excludedRecords === 0 && data.dataQuality.warnings.length === 0) return null;
  return (
    <View style={styles.notice}>
      <AppText variant="small" weight="medium">Alguns dados precisam de atenção</AppText>
      <AppText variant="small" tone="muted">
        {data.dataQuality.excludedRecords} registro(s) não entraram neste relatório. Revise os dados na versão web para mais detalhes.
      </AppText>
    </View>
  );
}

function healthTone(level: ReportResponse['health']['level']) {
  if (level === 'healthy') return colors.success;
  if (level === 'stable') return colors.brand;
  if (level === 'attention') return colors.warning;
  if (level === 'critical') return colors.danger;
  return colors.inkMuted;
}

function scoreSegmentColor(index: number, segmentCount: number) {
  const position = (index / Math.max(1, segmentCount - 1)) * 100;
  if (position < 50) return colors.danger;
  if (position < 70) return colors.warning;
  if (position < 85) return colors.brand;
  return colors.success;
}

function highlightTone(tone: ReportHighlight['tone']) {
  if (tone === 'success') return colors.success;
  if (tone === 'warning') return colors.warning;
  if (tone === 'danger') return colors.danger;
  return colors.brand;
}

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatPercentage(value: number | null) {
  return value === null ? '—' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

function formatDateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone }).format(new Date(value));
}

function barWidth(value: number, maximum: number) {
  return maximum > 0 ? Math.max(3, Math.min(100, (value / maximum) * 100)) : 3;
}

const styles = StyleSheet.create({
  container: { gap: spacing.xl },
  card: { gap: spacing.md, padding: spacing.xl, borderRadius: radius.xl, backgroundColor: colors.surfaceNeutral },
  cardHeading: { gap: spacing.xs },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.xl },
  metric: { width: '50%', gap: spacing.xs, paddingRight: spacing.sm },
  healthHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  healthHeading: { minWidth: 0, flex: 1, gap: spacing.xs },
  diagnosticBadge: { minHeight: 26, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radius.sm },
  healthBody: { gap: spacing.md },
  healthScoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  healthScore: { color: colors.ink },
  scoreSegments: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  scoreSegment: { height: 24, minWidth: 0, flex: 1, borderRadius: 3 },
  scoreSegmentEmpty: { backgroundColor: colors.border },
  healthDescription: { paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  statusDot: { width: 9, height: 9, borderRadius: radius.pill },
  compositionTrack: { height: 10, flexDirection: 'row', gap: 2, overflow: 'hidden', borderRadius: radius.pill, backgroundColor: colors.border },
  compositionSegment: { height: '100%', minWidth: 2 },
  trendList: { gap: spacing.md },
  trendLegend: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  legendDot: { width: 8, height: 8, borderRadius: radius.pill },
  trendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  trendLabel: { width: 58 },
  trendBars: { minWidth: 0, flex: 1, gap: spacing.xs },
  trendBarTrack: { height: 7, overflow: 'hidden', borderRadius: radius.pill, backgroundColor: colors.border },
  trendBar: { height: '100%', borderRadius: radius.pill },
  valueList: { gap: 0 },
  valueRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  valueLabel: { minWidth: 0, flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  highlightList: { gap: 0 },
  highlightRow: { minHeight: 66, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  highlightCopy: { minWidth: 0, flex: 1, gap: spacing.xs },
  highlightValue: { maxWidth: '28%', textAlign: 'right', color: colors.ink },
  occupancyList: { gap: spacing.lg },
  occupancyRow: { gap: spacing.xs },
  occupancyHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  occupancyName: { minWidth: 0, flex: 1 },
  occupancyTrack: { height: 8, overflow: 'hidden', borderRadius: radius.pill, backgroundColor: colors.border },
  occupancyProgress: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.brand },
  occupancySummary: { paddingTop: spacing.sm },
  notice: { gap: spacing.xs, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.brandSoft },
  updatedAt: { textAlign: 'center', paddingBottom: spacing.sm },
});

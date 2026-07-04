// ============================================================
// FuelTracker — Schermata statistiche veicolo
// Percorso Expo Router: app/stats/[vehicleId].tsx
//
// Grafici: SVG custom con react-native-svg (già supportato da
// Expo, rende identico su Android e web). Nessuna libreria di
// charting esterna: per due grafici semplici il controllo totale
// vale più delle feature di una libreria.
//
// Fonte dati: SQLite locale su Android (funziona offline),
// query Supabase su web. La logica di calcolo è la stessa:
// stats/consumption.ts.
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Polyline, Line, Rect, Circle, Text as SvgText } from 'react-native-svg';
import { useLocalSearchParams } from 'expo-router';
import { useDb } from '../../db/DbProvider';
import { listRefuels } from '../../db/dal';
import { computeSegments, computeStats, monthlySpend } from '../../stats/consumption';
import type { Refuel } from '../../types';

// ---------- Grafico a linea: km/l per segmento ----------

function LineChart({ values, width, height }: {
  values: number[]; width: number; height: number;
}) {
  if (values.length < 2) return <EmptyChart width={width} height={height} />;
  const pad = { top: 12, bottom: 20, left: 34, right: 12 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const x = (i: number) => pad.left + (i / (values.length - 1)) * w;
  const y = (v: number) => pad.top + h - ((v - min) / span) * h;
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');

  return (
    <Svg width={width} height={height}>
      {/* linee guida min/max con etichetta */}
      {[min, max].map((v) => (
        <G key={v} v={v} x1={pad.left} x2={width - pad.right} y={y(v)} />
      ))}
      <Polyline points={points} fill="none" stroke={c.accent} strokeWidth={2.5} />
      {values.map((v, i) => (
        <Circle key={i} cx={x(i)} cy={y(v)} r={3.5} fill={c.accent} />
      ))}
    </Svg>
  );
}

const G = ({ v, x1, x2, y }: { v: number; x1: number; x2: number; y: number }) => (
  <>
    <Line x1={x1} y1={y} x2={x2} y2={y} stroke={c.border} strokeDasharray="3,4" />
    <SvgText x={x1 - 6} y={y + 4} fontSize={11} fill={c.muted} textAnchor="end">
      {v.toFixed(1)}
    </SvgText>
  </>
);

// ---------- Grafico a barre: spesa mensile ----------

function BarChart({ data, width, height }: {
  data: { month: string; total: number }[]; width: number; height: number;
}) {
  if (data.length === 0) return <EmptyChart width={width} height={height} />;
  const pad = { top: 16, bottom: 24, left: 8, right: 8 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const max = Math.max(...data.map((d) => d.total)) || 1;
  const slot = w / data.length;
  const barW = Math.min(slot * 0.6, 40);

  return (
    <Svg width={width} height={height}>
      {data.map((d, i) => {
        const bh = (d.total / max) * h;
        const bx = pad.left + i * slot + (slot - barW) / 2;
        const by = pad.top + h - bh;
        return (
          <View key={d.month}>
            <Rect x={bx} y={by} width={barW} height={bh} rx={4} fill={c.accent} />
            <SvgText x={bx + barW / 2} y={by - 4} fontSize={10}
              fill={c.muted} textAnchor="middle">
              {Math.round(d.total)}
            </SvgText>
            <SvgText x={bx + barW / 2} y={pad.top + h + 14} fontSize={10}
              fill={c.muted} textAnchor="middle">
              {d.month.slice(5)}{/* "07" */}
            </SvgText>
          </View>
        );
      })}
    </Svg>
  );
}

const EmptyChart = ({ width, height }: { width: number; height: number }) => (
  <View style={[s.empty, { width, height }]}>
    <Text style={s.emptyText}>
      Servono almeno due pieni per calcolare il consumo.
    </Text>
  </View>
);

// ---------- Schermata ----------

export default function VehicleStatsScreen() {
  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
  const db = useDb();
  const { width } = useWindowDimensions();
  const chartW = Math.min(width - 40, 640);

  const [refuels, setRefuels] = useState<Refuel[]>([]);

  useEffect(() => {
    if (vehicleId) listRefuels(db, vehicleId).then(setRefuels);
  }, [db, vehicleId]);

  const segments = useMemo(() => computeSegments(refuels), [refuels]);
  const stats = useMemo(() => computeStats(segments), [segments]);
  const spend = useMemo(() => monthlySpend(refuels).slice(-12), [refuels]);
  const kmlSeries = segments
    .map((s) => s.km_per_liter)
    .filter((v): v is number => v !== null);

  const fmt = (v: number | null, suffix = '') =>
    v === null ? '—' : `${String(v).replace('.', ',')}${suffix}`;

  return (
    <ScrollView contentContainerStyle={s.container}>

      {/* Numeri chiave */}
      <View style={s.cards}>
        <StatCard label="Media" value={fmt(stats.avgKmPerLiter)} unit="km/l" big />
        <StatCard label="Ultimo pieno" value={fmt(stats.lastKmPerLiter)} unit="km/l" />
        <StatCard label="Costo" value={fmt(stats.avgCostPerKm, ' €')} unit="al km" />
        <StatCard label="Migliore" value={fmt(stats.bestKmPerLiter)} unit="km/l" />
      </View>

      <Text style={s.sectionTitle}>Consumo per pieno</Text>
      <LineChart values={kmlSeries} width={chartW} height={180} />

      <Text style={s.sectionTitle}>Spesa mensile (€)</Text>
      <BarChart data={spend} width={chartW} height={180} />

      <Text style={s.footnote}>
        {stats.segmentCount} tratte misurate · {fmt(stats.totalDistanceKm)} km ·{' '}
        {fmt(stats.totalLiters)} l · {fmt(stats.totalCost)} €
      </Text>
    </ScrollView>
  );
}

function StatCard({ label, value, unit, big }: {
  label: string; value: string; unit: string; big?: boolean;
}) {
  return (
    <View style={s.card}>
      <Text style={s.cardLabel}>{label}</Text>
      <Text style={[s.cardValue, big && s.cardValueBig]}>{value}</Text>
      <Text style={s.cardUnit}>{unit}</Text>
    </View>
  );
}

const c = {
  bg: '#FFFFFF', text: '#1A1D21', muted: '#6B7280',
  border: '#D1D5DB', accent: '#0F6E5D', cardBg: '#F4F6F5',
};

const s = StyleSheet.create({
  container: { padding: 20, gap: 12, backgroundColor: c.bg },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: {
    backgroundColor: c.cardBg, borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 16,
    minWidth: '45%', flexGrow: 1,
  },
  cardLabel: { fontSize: 12, color: c.muted, fontWeight: '600' },
  cardValue: { fontSize: 22, fontWeight: '700', color: c.text, fontVariant: ['tabular-nums'] },
  cardValueBig: { fontSize: 30, color: c.accent },
  cardUnit: { fontSize: 12, color: c.muted },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: c.text, marginTop: 16 },
  empty: { alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: c.muted, fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },
  footnote: { fontSize: 12, color: c.muted, marginTop: 8 },
});

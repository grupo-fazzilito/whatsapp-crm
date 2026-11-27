// Charts for the PDF report, drawn with react-pdf's SVG primitives (no
// browser). Simple, readable shapes: bars, stacked bars, heatmap.
import { G, Line, Rect, Svg, Text as SvgText, View, Text } from '@react-pdf/renderer'
import { niceTicks } from '../format'
import { C, pdfText } from './theme'

const AXIS = { fontSize: 6.5, fill: C.muted }

/** Grouped vertical bars per category (e.g. per day: received vs sent). */
export function GroupedBars({
  width,
  height = 150,
  labels,
  series,
}: {
  width: number
  height?: number
  labels: string[]
  series: { name: string; color: string; values: number[] }[]
}) {
  const padL = 26
  const padB = 18
  const plotW = width - padL - 4
  const plotH = height - padB - 6
  const max = Math.max(1, ...series.flatMap((s) => s.values))
  const ticks = niceTicks(max)
  const top = ticks[ticks.length - 1] || 1
  const n = Math.max(1, labels.length)
  const slot = plotW / n
  const barW = Math.max(1.5, Math.min(12, (slot * 0.75) / series.length))
  const every = Math.ceil(n / 12)
  return (
    <Svg width={width} height={height}>
      {ticks.map((tk) => {
        const y = 6 + plotH - (tk / top) * plotH
        return (
          <G key={tk}>
            <Line x1={padL} x2={width - 4} y1={y} y2={y} stroke={C.grid} strokeWidth={0.5} />
            <SvgText x={padL - 4} y={y + 2} style={AXIS} textAnchor="end">
              {String(tk)}
            </SvgText>
          </G>
        )
      })}
      {labels.map((label, i) => {
        const x0 = padL + i * slot + (slot - barW * series.length) / 2
        return (
          <G key={label + i}>
            {series.map((s, j) => {
              const h = (s.values[i] / top) * plotH
              return <Rect key={s.name} x={x0 + j * barW} y={6 + plotH - h} width={barW - 0.6} height={Math.max(0, h)} fill={s.color} rx={0.8} />
            })}
            {i % every === 0 && (
              <SvgText x={padL + i * slot + slot / 2} y={height - 6} style={AXIS} textAnchor="middle">
                {pdfText(label)}
              </SvgText>
            )}
          </G>
        )
      })}
    </Svg>
  )
}

/** Horizontal bars with the value at the end (channels, agents, statuses). */
export function HBars({ width, rows, color = C.primary, format = String }: { width: number; rows: { label: string; value: number }[]; color?: string; format?: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  const labelW = Math.min(130, width * 0.34)
  const barMax = width - labelW - 46
  return (
    <View>
      {rows.map((r, i) => (
        <View key={r.label + i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
          <Text style={{ width: labelW, fontSize: 8, color: C.text, paddingRight: 6 }}>{pdfText(r.label)}</Text>
          <View style={{ width: Math.max(1.5, (r.value / max) * barMax), height: 9, backgroundColor: color, borderRadius: 2 }} />
          <Text style={{ fontSize: 8, color: C.text, marginLeft: 5, fontFamily: 'Helvetica-Bold' }}>{format(r.value)}</Text>
        </View>
      ))}
    </View>
  )
}

/** One 100 % bar split in parts, with its legend below. */
export function StackBar({ width, parts }: { width: number; parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0)
  return (
    <View>
      <View style={{ flexDirection: 'row', width, height: 16, borderRadius: 4, overflow: 'hidden', backgroundColor: C.grid }}>
        {total > 0 && parts.filter((p) => p.value > 0).map((p) => <View key={p.label} style={{ width: (p.value / total) * width, height: 16, backgroundColor: p.color }} />)}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
        {parts.map((p) => (
          <View key={p.label} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 12, marginBottom: 3 }}>
            <View style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: p.color, marginRight: 4 }} />
            <Text style={{ fontSize: 8, color: C.text }}>
              {pdfText(p.label)}: <Text style={{ fontFamily: 'Helvetica-Bold' }}>{p.value}</Text>
              {total > 0 ? ` (${Math.round((p.value / total) * 100)} %)` : ''}
            </Text>
          </View>
        ))}
      </View>
    </View>
  )
}

/** Weekday × hour heatmap (rows Mon..Sun, 24 columns). */
export function Heatmap({ width, data, days }: { width: number; data: number[][]; days: string[] }) {
  const labelW = 26
  const cell = (width - labelW) / 24
  const h = cell * 7 + 12
  const max = Math.max(1, ...data.flat())
  return (
    <Svg width={width} height={h}>
      {data.map((row, d) => (
        <G key={d}>
          <SvgText x={0} y={d * cell + cell * 0.7} style={AXIS}>
            {pdfText(days[d] ?? '')}
          </SvgText>
          {row.map((v, hr) => (
            <Rect
              key={hr}
              x={labelW + hr * cell + 0.4}
              y={d * cell + 0.4}
              width={cell - 0.8}
              height={cell - 0.8}
              rx={1}
              fill={v === 0 ? C.grid : C.primary}
              fillOpacity={v === 0 ? 1 : 0.18 + 0.82 * (v / max)}
            />
          ))}
        </G>
      ))}
      {[0, 6, 12, 18, 23].map((hr) => (
        <SvgText key={hr} x={labelW + hr * cell + cell / 2} y={cell * 7 + 9} style={AXIS} textAnchor="middle">
          {`${hr}h`}
        </SvgText>
      ))}
    </Svg>
  )
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 }}>
      {items.map((i) => (
        <View key={i.label} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 12 }}>
          <View style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: i.color, marginRight: 4 }} />
          <Text style={{ fontSize: 8, color: C.muted }}>{pdfText(i.label)}</Text>
        </View>
      ))}
    </View>
  )
}

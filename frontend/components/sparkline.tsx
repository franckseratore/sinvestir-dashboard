'use client'
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts'

interface SparklineProps {
  data: number[]
  color?: string
  height?: number
}

const STATUS_COLORS: Record<string, string> = {
  green: '#10B981',
  orange: '#F59E0B',
  red: '#F43F5E',
  unknown: '#d4d4d8',
}

export function Sparkline({ data, color = '#3B82F6', height = 40 }: SparklineProps) {
  if (!data || data.length === 0) return <div style={{ height }} />

  const chartData = data.map((v) => ({ v }))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          fill={color}
          fillOpacity={0.08}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
        <Tooltip
          content={() => null}
          cursor={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function sparklineColor(status: string): string {
  return STATUS_COLORS[status] ?? STATUS_COLORS.unknown
}

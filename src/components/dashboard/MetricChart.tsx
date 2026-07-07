"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { ZabbixMetricPoint } from "@/lib/zabbix";

interface MetricChartProps {
  data: ZabbixMetricPoint[];
  title?: string;
}

interface ChartPoint {
  time: string;
  value: number;
}

export function MetricChart({ data, title = "CPU (%)" }: MetricChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 rounded-lg border border-white/10 bg-white/5">
        <p className="text-white/40 text-sm">Données indisponibles</p>
        <p className="text-white/20 text-xs mt-1">
          Impossible de contacter Zabbix
        </p>
      </div>
    );
  }

  const chartData: ChartPoint[] = data.map((p) => ({
    time: new Date(p.clock * 1000).toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    value: parseFloat(p.value) || 0,
  }));

  return (
    <div>
      {title && (
        <p className="text-sm text-white/50 mb-3 font-medium">{title}</p>
      )}
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart
          data={chartData}
          margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
        >
          <defs>
            <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#F97316" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#F97316" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis
            dataKey="time"
            tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#0D1B2A",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "8px",
              color: "#fff",
              fontSize: "12px",
            }}
            labelStyle={{ color: "rgba(255,255,255,0.6)" }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#F97316"
            strokeWidth={2}
            fill="url(#cpuGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

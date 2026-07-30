"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { MarketProbabilityHistory } from "@/types/database";

interface ProbabilityChartProps {
  history: MarketProbabilityHistory[];
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}

function CustomTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.[0]) return null;
  return (
    <div
      className="rounded-lg px-2.5 py-1.5 text-xs font-semibold shadow-md"
      style={{
        backgroundColor: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        color: "var(--color-ink-primary)",
      }}
    >
      YES: {Math.round((payload[0].value ?? 0) * 100)}%
    </div>
  );
}

export function ProbabilityChart({ history }: ProbabilityChartProps) {
  if (history.length < 2) {
    return (
      <div
        className="flex items-center justify-center h-24 rounded-xl text-xs"
        style={{
          backgroundColor: "var(--color-bg)",
          color: "var(--color-ink-tertiary)",
        }}
        data-testid="probability-chart-empty"
      >
        Not enough data yet — place the first bet!
      </div>
    );
  }

  const data = history.map((h) => ({
    time: new Date(h.recorded_at).getTime(),
    probability: h.yes_probability,
  }));

  return (
    <div className="h-40" data-testid="probability-chart" data-points={history.length}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 4, right: 4, bottom: 0, left: -28 }}
        >
          <XAxis dataKey="time" hide />
          <YAxis
            domain={[0, 1]}
            tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
            tick={{ fontSize: 10, fill: "var(--color-ink-tertiary)" }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine y={0.5} stroke="var(--color-border)" strokeDasharray="4 4" />
          <Line
            type="monotone"
            dataKey="probability"
            stroke="var(--color-primary)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: "var(--color-primary)" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

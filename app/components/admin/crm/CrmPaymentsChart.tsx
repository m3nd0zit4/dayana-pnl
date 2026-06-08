"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Point = { date: string; amountUsd: number };

const CrmPaymentsChart = ({ data }: { data: Point[] }) => (
  <div className="crm-chart-card flex h-full min-h-[280px] flex-col">
    <div>
      <h2 className="crm-section-title text-base">Ingresos (USD)</h2>
      <p className="crm-section-subtitle mt-0.5">Últimos 14 días · pagos aprobados</p>
    </div>
    <div className="mt-4 min-h-[220px] flex-1">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="crmPayGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#edc3b1" stopOpacity={0.55} />
              <stop offset="100%" stopColor="#ece3d4" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(20,18,16,0.06)" />
          <XAxis
            dataKey="date"
            tick={{ fill: "#6f655c", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#6f655c", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip
            formatter={(v) => [`$${Number(v).toFixed(0)}`, "Total"]}
            contentStyle={{
              borderRadius: 12,
              border: "1px solid rgba(20,18,16,0.08)",
              fontSize: 13,
            }}
          />
          <Area
            type="monotone"
            dataKey="amountUsd"
            stroke="#5c4a3a"
            strokeWidth={2}
            fill="url(#crmPayGrad)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  </div>
);

export default CrmPaymentsChart;

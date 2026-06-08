"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Point = { label: string; count: number };

const CrmPipelineChart = ({ data }: { data: Point[] }) => (
  <div className="crm-chart-card flex h-full min-h-[280px] flex-col">
    <div>
      <h2 className="crm-section-title text-base">Pipeline</h2>
      <p className="crm-section-subtitle mt-0.5">Servicios por estado</p>
    </div>
    <div className="mt-4 min-h-[220px] flex-1">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 4, right: 12 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(20,18,16,0.06)" />
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            width={100}
            tick={{ fill: "#6f655c", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 12,
              border: "1px solid rgba(20,18,16,0.08)",
              fontSize: 13,
            }}
          />
          <Bar dataKey="count" fill="#d4b896" radius={[0, 6, 6, 0]} barSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  </div>
);

export default CrmPipelineChart;

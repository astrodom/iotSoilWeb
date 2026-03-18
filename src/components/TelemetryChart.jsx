import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

function TelemetryChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={460}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
        <defs>
          <linearGradient id="tempFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(73, 201, 255, 0.45)" />
            <stop offset="100%" stopColor="rgba(73, 201, 255, 0.02)" />
          </linearGradient>
          <linearGradient id="vwcFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(181, 255, 70, 0.35)" />
            <stop offset="100%" stopColor="rgba(181, 255, 70, 0.02)" />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="rgba(64, 154, 197, 0.12)" vertical={false} />
        <XAxis
          dataKey="timestamp"
          tick={{ fill: "rgba(199, 246, 255, 0.74)", fontSize: 11 }}
          tickFormatter={formatTimestampTick}
          minTickGap={24}
          stroke="rgba(73, 201, 255, 0.24)"
        />
        <YAxis
          yAxisId="temp"
          tick={{ fill: "#49c9ff", fontSize: 11 }}
          stroke="rgba(73, 201, 255, 0.24)"
        />
        <YAxis
          yAxisId="vwc"
          orientation="right"
          tick={{ fill: "#b5ff46", fontSize: 11 }}
          stroke="rgba(181, 255, 70, 0.24)"
        />
        <Tooltip content={<ChartTooltip />} />
        <Legend wrapperStyle={{ color: "#c7f6ff", fontSize: "12px" }} />
        <Area
          yAxisId="temp"
          type="monotone"
          dataKey="temp"
          name="Temperature"
          stroke="#49c9ff"
          fill="url(#tempFill)"
          strokeWidth={2}
          connectNulls
        />
        <Area
          yAxisId="vwc"
          type="monotone"
          dataKey="vwc"
          name="VWC"
          stroke="#b5ff46"
          fill="url(#vwcFill)"
          strokeWidth={2}
          connectNulls
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-label">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="chart-tooltip-item">
          <span>{entry.name}</span>
          <strong>
            {entry.value}
            {entry.dataKey === "vwc" ? "%" : "°C"}
          </strong>
        </p>
      ))}
    </div>
  );
}

function formatTimestampTick(value) {
  const parsed = Date.parse(value.replaceAll(".", "-").replace(" ", "T").replace(/\//g, "-"));

  if (Number.isNaN(parsed)) {
    return value.length > 10 ? value.slice(5, 10) : value;
  }

  const date = new Date(parsed);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export default TelemetryChart;

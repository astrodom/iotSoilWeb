import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const TEMP_COLOR = "#49c9ff";
const TEMP_AXIS_COLOR = "#144f79";
const VWC_COLOR = "#b5ff46";
const VWC_AXIS_COLOR = "#2f5f17";
const RAIN_COLOR = "#2f80ed";
const RAIN_AXIS_COLOR = "#164f9c";

function TelemetryChart({ data }) {
  const isSingleDayDataset = hasSingleDayRange(data);

  return (
    <ResponsiveContainer width="100%" height={460}>
      <ComposedChart data={data} margin={{ top: 8, right: 94, left: 8, bottom: 8 }}>
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
          tick={{ fill: "#3a3024", fontSize: 12, fontWeight: 700 }}
          tickFormatter={(value) => formatTimestampTick(value, isSingleDayDataset)}
          minTickGap={24}
          stroke="rgba(77, 58, 33, 0.18)"
        />
        <YAxis
          yAxisId="temp"
          width={68}
          tick={{ fill: TEMP_AXIS_COLOR, fontSize: 12, fontWeight: 800 }}
          stroke={TEMP_AXIS_COLOR}
          label={{
            value: "Temperature (°C)",
            angle: -90,
            position: "insideLeft",
            fill: TEMP_AXIS_COLOR,
            fontSize: 12,
            fontWeight: 800,
            dx: -6,
          }}
        />
        <YAxis
          yAxisId="vwc"
          orientation="right"
          width={54}
          tick={{ fill: VWC_AXIS_COLOR, fontSize: 12, fontWeight: 800 }}
          stroke={VWC_AXIS_COLOR}
          label={{
            value: "VWC (%)",
            angle: 90,
            position: "insideRight",
            fill: VWC_AXIS_COLOR,
            fontSize: 11,
            fontWeight: 800,
            dx: -8,
          }}
        />
        <YAxis
          yAxisId="rain"
          orientation="right"
          width={60}
          tick={{ fill: RAIN_AXIS_COLOR, fontSize: 12, fontWeight: 800 }}
          stroke={RAIN_AXIS_COLOR}
          label={{
            value: "Rainfall (mm)",
            angle: 90,
            position: "right",
            fill: RAIN_AXIS_COLOR,
            fontSize: 11,
            fontWeight: 800,
            dx: 22,
          }}
        />
        <Tooltip content={<ChartTooltip />} />
        <Legend wrapperStyle={{ color: "#c7f6ff", fontSize: "12px" }} />
        <Area
          yAxisId="temp"
          type="monotone"
          dataKey="temp"
          name="Temperature"
          stroke={TEMP_COLOR}
          fill="url(#tempFill)"
          strokeWidth={2}
          connectNulls
        />
        <Area
          yAxisId="vwc"
          type="monotone"
          dataKey="vwc"
          name="VWC"
          stroke={VWC_COLOR}
          fill="url(#vwcFill)"
          strokeWidth={2}
          connectNulls
        />
        <Bar
          yAxisId="rain"
          dataKey="rainfall"
          name="Rainfall"
          fill={RAIN_COLOR}
          fillOpacity={0.72}
          stroke={RAIN_AXIS_COLOR}
          strokeWidth={1}
          barSize={10}
        />
      </ComposedChart>
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
            {getTooltipUnit(entry.dataKey)}
          </strong>
        </p>
      ))}
    </div>
  );
}

function formatTimestampTick(value, isSingleDayDataset) {
  const parsed = parseTimestamp(value);

  if (parsed === null) {
    if (isSingleDayDataset) {
      const timeMatch = value.match(/(\d{1,2}):(\d{2})/);
      return timeMatch ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}` : value;
    }

    return value.length > 10 ? value.slice(5, 10) : value;
  }

  const date = new Date(parsed);

  if (isSingleDayDataset) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  return `${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

function getTooltipUnit(dataKey) {
  if (dataKey === "vwc") {
    return "%";
  }

  if (dataKey === "rainfall") {
    return " mm";
  }

  return "°C";
}

function hasSingleDayRange(data) {
  const parsedDates = data.map((item) => parseTimestamp(item.timestamp)).filter((value) => value !== null);

  if (!parsedDates.length) {
    return false;
  }

  const first = new Date(parsedDates[0]);
  return parsedDates.every((value) => {
    const current = new Date(value);

    return (
      current.getFullYear() === first.getFullYear() &&
      current.getMonth() === first.getMonth() &&
      current.getDate() === first.getDate()
    );
  });
}

function parseTimestamp(value) {
  const normalized = normalizeTimestamp(value);
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeTimestamp(value) {
  const base = String(value).trim().replaceAll("/", "-").replaceAll(".", "-");
  const withTimeSeparator = base.replace(
    /^(\d{4}-\d{2}-\d{2})[-\s](\d{2}:\d{2}(?::\d{2})?)$/,
    "$1T$2",
  );
  return withTimeSeparator;
}

export default TelemetryChart;

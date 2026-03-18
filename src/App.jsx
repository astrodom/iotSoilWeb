import { Suspense, lazy, startTransition, useDeferredValue, useEffect, useState } from "react";

const API_ENDPOINT = "https://puis3e72h4.execute-api.ap-northeast-2.amazonaws.com/dev";
const CURRENT_YEAR = new Date().getFullYear();
const SENSOR_PRESETS = [
  { id: "22096028", label: "lounge 앞 화단" },
  { id: "22096027", label: "원형 화단" },
];
const QUICK_RANGES = [
  { key: "today", label: "오늘" },
  { key: "7d", label: "최근 7일" },
  { key: "30d", label: "최근 30일" },
  { key: "month", label: "이번 달" },
  { key: "thisYear", label: "올해" },
  { key: "lastYear", label: `${CURRENT_YEAR - 1}년` },
  { key: "twoYearsAgo", label: `${CURRENT_YEAR - 2}년` },
];
const VIEW_WINDOWS = [
  { value: "24", label: "최근 24건" },
  { value: "72", label: "최근 72건" },
  { value: "168", label: "최근 168건" },
  { value: "all", label: "전체" },
];
const SEASON_META = {
  winter: { label: "겨울", shortLabel: "Winter", accentClass: "winter" },
  spring: { label: "봄", shortLabel: "Spring", accentClass: "spring" },
  summer: { label: "여름", shortLabel: "Summer", accentClass: "summer" },
  autumn: { label: "가을", shortLabel: "Autumn", accentClass: "autumn" },
};
const TelemetryChart = lazy(() => import("./components/TelemetryChart"));

function App() {
  const [form, setForm] = useState(() => ({
    startDate: "",
    endDate: "",
    sensorPreset: SENSOR_PRESETS[0].id,
    deviceId: SENSOR_PRESETS[0].id,
  }));
  const [activeRange, setActiveRange] = useState("month");
  const [status, setStatus] = useState({ label: "READY", tone: "" });
  const [message, setMessage] = useState({
    text: "날짜는 안전하게 처리한 뒤 API 형식인 yyyy.mm.dd로 변환됩니다.",
    error: false,
  });
  const [rows, setRows] = useState([]);
  const [lastPayload, setLastPayload] = useState(null);
  const [viewWindow, setViewWindow] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const deferredSearchTerm = useDeferredValue(searchTerm);

  useEffect(() => {
    const nextRange = buildQuickRange("month");
    setForm((current) => ({
      ...current,
      startDate: nextRange.startDate,
      endDate: nextRange.endDate,
    }));
  }, []);

  let visibleRows = rows;
  const normalizedSearch = deferredSearchTerm.trim().toLowerCase();

  if (normalizedSearch) {
    visibleRows = visibleRows.filter((row) =>
      row.timestamp.toLowerCase().includes(normalizedSearch),
    );
  }

  if (viewWindow !== "all") {
    visibleRows = visibleRows.slice(-Number(viewWindow));
  }

  const metrics = deriveMetrics(rows);
  const insights = deriveInsights(rows, visibleRows, lastPayload, viewWindow, deferredSearchTerm);
  const seasonBands = buildSeasonBands(visibleRows);
  const seasonSummaries = summarizeSeasons(visibleRows);
  const seasonGroups = groupRowsBySeason(visibleRows);

  const handleFormChange = (field) => (event) => {
    const value = event.target.value;
    setForm((current) => {
      const next = { ...current, [field]: value };

      if (field === "sensorPreset" && value) {
        next.deviceId = value;
      }

      if (field === "deviceId") {
        const matchingPreset = SENSOR_PRESETS.find((preset) => preset.id === value.trim());
        next.sensorPreset = matchingPreset ? matchingPreset.id : "";
      }

      return next;
    });
  };

  const handleSensorCardClick = (sensorId) => {
    setForm((current) => ({
      ...current,
      sensorPreset: sensorId,
      deviceId: sensorId,
    }));
    setMessage({
      text: `${resolveSensorName(sensorId)} 선택됨. 즉시 조회할 수 있습니다.`,
      error: false,
    });
  };

  const handleRangeClick = (rangeKey) => {
    const range = buildQuickRange(rangeKey);
    setActiveRange(rangeKey);
    setForm((current) => ({
      ...current,
      startDate: range.startDate,
      endDate: range.endDate,
    }));
  };

  const handleReset = () => {
    const nextRange = buildQuickRange("month");
    setActiveRange("month");
    setForm({
      startDate: nextRange.startDate,
      endDate: nextRange.endDate,
      sensorPreset: SENSOR_PRESETS[0].id,
      deviceId: SENSOR_PRESETS[0].id,
    });
    setRows([]);
    setLastPayload(null);
    setViewWindow("all");
    setSearchTerm("");
    setStatus({ label: "READY", tone: "" });
    setMessage({
      text: "기본 조회 설정으로 되돌렸습니다.",
      error: false,
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const validationError = validateForm(form);
    if (validationError) {
      setStatus({ label: "INPUT ERROR", tone: "error" });
      setMessage({ text: validationError, error: true });
      return;
    }

    const payload = {
      start_date: toApiDate(form.startDate),
      end_date: toApiDate(addDays(form.endDate, 1)),
      device_id: form.deviceId.trim(),
      rawStartDate: form.startDate,
      rawEndDate: form.endDate,
    };

    setIsLoading(true);
    setStatus({ label: "LOADING", tone: "loading" });
    setMessage({
      text: "원격 API에서 센서 데이터를 조회 중입니다.",
      error: false,
    });

    try {
      const response = await fetch(API_ENDPOINT, {
        method: "POST",
        mode: "cors",
        cache: "no-cache",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          start_date: payload.start_date,
          end_date: payload.end_date,
          device_id: payload.device_id,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = normalizeRows(await response.json());
      startTransition(() => {
        setRows(data);
        setLastPayload(payload);
      });
      setStatus({ label: "ONLINE", tone: "" });
      setMessage({
        text: `센서 ${payload.device_id} 데이터를 성공적으로 불러왔습니다.`,
        error: false,
      });
    } catch (error) {
      console.error(error);
      startTransition(() => {
        setRows([]);
        setLastPayload(null);
      });
      setStatus({ label: "REQUEST FAIL", tone: "error" });
      setMessage({
        text: "데이터를 불러오지 못했습니다. API 상태, CORS 설정, 응답 형식을 확인하세요.",
        error: true,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">HDC Labs / Soil Monitoring</p>
          <h1>Sensor Trend Dashboard</h1>
          <p className="topbar-copy">
            센서 추이를 메인으로 보고, 아래에서 계절 기준으로 상세 측정값을 바로 확인할 수 있게
            단순한 구조로 재배치했습니다.
          </p>
        </div>
        <div className="topbar-status">
          <span className="status-label">AWS API Gateway</span>
          <span className={`status-chip ${status.tone}`.trim()}>{status.label}</span>
        </div>
      </header>

      <section className="panel control-panel">
        <div className="panel-head">
          <div>
            <p className="section-kicker">Query</p>
            <h2>조회 조건</h2>
          </div>
          <p className={`support-text ${message.error ? "error" : ""}`.trim()}>{message.text}</p>
        </div>

        <div className="sensor-shortcuts">
          {SENSOR_PRESETS.map((sensor) => (
            <button
              key={sensor.id}
              type="button"
              className={`sensor-pill ${form.deviceId === sensor.id ? "is-active" : ""}`.trim()}
              onClick={() => handleSensorCardClick(sensor.id)}
            >
              <strong>{sensor.id}</strong>
              <span>{sensor.label}</span>
            </button>
          ))}
        </div>

        <div className="range-row" aria-label="Quick ranges">
          {QUICK_RANGES.map((range) => (
            <button
              key={range.key}
              type="button"
              className={`range-chip ${activeRange === range.key ? "is-active" : ""}`.trim()}
              onClick={() => handleRangeClick(range.key)}
            >
              {range.label}
            </button>
          ))}
        </div>

        <form className="control-grid" onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span>시작일</span>
            <input type="date" value={form.startDate} onChange={handleFormChange("startDate")} required />
          </label>

          <label className="field">
            <span>종료일</span>
            <input type="date" value={form.endDate} onChange={handleFormChange("endDate")} required />
          </label>

          <label className="field">
            <span>센서 프리셋</span>
            <select value={form.sensorPreset} onChange={handleFormChange("sensorPreset")}>
              <option value="22096028">22096028 | lounge 앞 화단</option>
              <option value="22096027">22096027 | 원형 화단</option>
              <option value="">직접 입력</option>
            </select>
          </label>

          <label className="field">
            <span>센서 ID</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="22096028"
              value={form.deviceId}
              onChange={handleFormChange("deviceId")}
              required
            />
          </label>

          <div className="action-row">
            <button type="submit" className="primary-button" disabled={isLoading}>
              {isLoading ? "조회 중..." : "조회"}
            </button>
            <button type="button" className="secondary-button" disabled={isLoading} onClick={handleReset}>
              초기화
            </button>
          </div>
        </form>
      </section>

      <section className="metrics-grid" aria-label="Summary metrics">
        <MetricPanel label="Samples" value={metrics.sampleCount} subtext="조회된 전체 레코드 수" />
        <MetricPanel label="Latest Temp" value={metrics.latestTemp} subtext="가장 최근 온도" />
        <MetricPanel label="Latest VWC" value={metrics.latestVwc} subtext="가장 최근 수분 함량" />
        <MetricPanel label="Avg Temp" value={metrics.averageTemp} subtext="조회 구간 평균 온도" />
        <MetricPanel label="Temp Band" value={metrics.tempBand} subtext="최저 / 최고 온도" />
        <MetricPanel label="Moisture Band" value={metrics.moistureBand} subtext="최저 / 최고 수분" />
      </section>

      <section className="panel trend-panel">
        <div className="panel-head panel-head-tight">
          <div>
            <p className="section-kicker">Trend View</p>
            <h2>센서 데이터</h2>
          </div>
          <div className="trend-toolbar">
            <label className="field compact-field">
              <span>보기 기준</span>
              <select value={viewWindow} onChange={(event) => setViewWindow(event.target.value)}>
                {VIEW_WINDOWS.map((windowOption) => (
                  <option key={windowOption.value} value={windowOption.value}>
                    {windowOption.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="secondary-button"
              disabled={!visibleRows.length || isLoading}
              onClick={() => exportVisibleRows(visibleRows, lastPayload)}
            >
              CSV 내보내기
            </button>
          </div>
        </div>

        <div className="trend-summary">
          <p>{insights.summary}</p>
          <div className="summary-chips">
            <span>{insights.currentView}</span>
            <span>{insights.avgSampleGap}</span>
            <span>{insights.latestCapture}</span>
          </div>
        </div>

        <div className="chart-wrap chart-wrap-wide">
          {visibleRows.length ? (
            <Suspense fallback={<EmptyPanel message="차트 모듈을 로딩 중입니다." />}>
              <TelemetryChart data={visibleRows} />
            </Suspense>
          ) : (
            <EmptyPanel message={insights.chartEmptyMessage} />
          )}
        </div>

        <div className="season-panel">
          <div className="season-panel-head">
            <div>
              <p className="section-kicker">Season View</p>
              <h3>계절 구간</h3>
            </div>
            <p className="support-text">
              12월~2월 겨울, 3월~5월 봄, 6월~8월 여름, 9월~11월 가을 기준으로 현재 차트 데이터를 나눴습니다.
            </p>
          </div>

          {seasonBands.length ? (
            <>
              <div className="season-strip">
                {seasonBands.map((band, index) => (
                  <div
                    key={`${band.season.key}-${band.start}-${index}`}
                    className={`season-band ${band.season.accentClass}`.trim()}
                    style={{ flexGrow: band.count }}
                  >
                    <span className="season-band-label">{band.season.label}</span>
                    <strong>{band.count}건</strong>
                    <small>{`${formatShortDate(band.start)} - ${formatShortDate(band.end)}`}</small>
                  </div>
                ))}
              </div>

              <div className="season-summary-grid">
                {seasonSummaries.map((item) => (
                  <article
                    key={item.season.key}
                    className={`season-summary-card ${item.season.accentClass}`.trim()}
                  >
                    <p>{item.season.label}</p>
                    <strong>{item.count}건</strong>
                    <span>{item.rangeText}</span>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <EmptyPanel message="표시할 차트 데이터가 없어 계절 구간을 만들지 않았습니다." />
          )}
        </div>
      </section>

      <section className="panel feed-panel">
        <div className="panel-head panel-head-tight">
          <div>
            <p className="section-kicker">Data Feed</p>
            <h2>상세 측정값</h2>
          </div>
          <div className="feed-tools">
            <label className="field feed-search">
              <span className="sr-only">Timestamp search</span>
              <input
                type="search"
                placeholder="timestamp 검색 예: 2023.06.01 09"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </label>
          </div>
        </div>

        <p className="support-text">{insights.resultsHint}</p>

        {seasonGroups.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">계절</th>
                  <th scope="col">Timestamp</th>
                  <th scope="col">Temperature</th>
                  <th scope="col">VWC</th>
                </tr>
              </thead>
              <tbody>
                {seasonGroups.map((group, groupIndex) => (
                  <SeasonGroupRows key={`${group.season.key}-${groupIndex}`} group={group} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyPanel message={insights.tableEmptyMessage} />
        )}
      </section>
    </div>
  );
}

function MetricPanel({ label, value, subtext }) {
  return (
    <article className="metric-card">
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
      <p className="metric-subtext">{subtext}</p>
    </article>
  );
}

function SeasonGroupRows({ group }) {
  return (
    <>
      <tr className={`season-divider ${group.season.accentClass}`.trim()}>
        <td colSpan="4">
          <div className="season-divider-content">
            <strong>{group.season.label}</strong>
            <span>{`${formatShortDate(group.start)} - ${formatShortDate(group.end)}`}</span>
            <span>{`${group.rows.length}건`}</span>
          </div>
        </td>
      </tr>
      {group.rows.map((row) => (
        <tr key={`${group.season.key}-${row.timestamp}`}>
          <td>
            <span className={`season-tag ${group.season.accentClass}`.trim()}>{group.season.label}</span>
          </td>
          <td>{row.timestamp}</td>
          <td>{formatMetric(row.temp, "°C")}</td>
          <td>{formatMetric(row.vwc, "%")}</td>
        </tr>
      ))}
    </>
  );
}

function EmptyPanel({ message }) {
  return (
    <div className="empty-state">
      <p>{message}</p>
    </div>
  );
}

function deriveMetrics(rows) {
  if (!rows.length) {
    return {
      sampleCount: "0",
      latestTemp: "-",
      latestVwc: "-",
      averageTemp: "-",
      tempBand: "-",
      moistureBand: "-",
    };
  }

  const latest = rows[rows.length - 1];
  const temps = rows.map((row) => row.temp).filter(isPresentNumber);
  const vwcs = rows.map((row) => row.vwc).filter(isPresentNumber);

  return {
    sampleCount: String(rows.length),
    latestTemp: formatMetric(latest.temp, "°C"),
    latestVwc: formatMetric(latest.vwc, "%"),
    averageTemp: formatMetric(calculateAverage(temps), "°C"),
    tempBand: formatBand(temps, "°C"),
    moistureBand: formatBand(vwcs, "%"),
  };
}

function deriveInsights(rows, visibleRows, lastPayload, viewWindow, searchTerm) {
  if (!rows.length || !lastPayload) {
    return {
      latestCapture: "-",
      avgSampleGap: "-",
      currentView: "0 / 0 rows",
      summary: "데이터를 조회하면 센서 추이와 상세 측정값이 여기에 표시됩니다.",
      resultsHint: "조회 후 아래 리스트에서 계절별 데이터를 확인할 수 있습니다.",
      chartEmptyMessage: "조회 전입니다. 날짜와 센서 ID를 선택한 뒤 데이터를 불러오세요.",
      tableEmptyMessage: "조회 전입니다. 날짜와 센서 ID를 선택한 뒤 데이터를 불러오세요.",
    };
  }

  const latest = rows[rows.length - 1];
  const viewLabel = viewWindow === "all" ? "전체" : `최근 ${viewWindow}건`;
  const filterLabel = searchTerm.trim() ? ` | 검색: ${searchTerm.trim()}` : "";
  const emptyFilteredMessage =
    "현재 검색 조건과 보기 기준에 맞는 레코드가 없습니다. 검색어를 지우거나 보기 범위를 넓혀보세요.";

  return {
    latestCapture: `최근 측정 ${latest.timestamp}`,
    avgSampleGap: `평균 간격 ${calculateAverageGap(rows)}`,
    currentView: `${visibleRows.length} / ${rows.length} rows`,
    summary: `${resolveSensorName(lastPayload.device_id)} | ${lastPayload.start_date} - ${toApiDate(lastPayload.rawEndDate)} | 보기: ${viewLabel}${filterLabel}`,
    resultsHint: `${visibleRows.length}건이 현재 리스트에 표시됩니다. 계절 헤더와 계절 컬럼을 함께 확인하세요.`,
    chartEmptyMessage: visibleRows.length
      ? "데이터를 조회하면 차트가 여기에 표시됩니다."
      : emptyFilteredMessage,
    tableEmptyMessage: visibleRows.length
      ? "데이터를 조회하면 리스트가 여기에 표시됩니다."
      : emptyFilteredMessage,
  };
}

function validateForm(form) {
  if (!form.startDate || !form.endDate) {
    return "시작일과 종료일을 모두 입력해야 합니다.";
  }

  if (form.startDate > form.endDate) {
    return "시작일은 종료일보다 늦을 수 없습니다.";
  }

  if (!/^\d{6,}$/.test(form.deviceId.trim())) {
    return "센서 ID는 숫자 6자리 이상으로 입력하세요.";
  }

  return "";
}

function buildQuickRange(range) {
  const today = new Date();
  let startDate = new Date(today.getFullYear(), today.getMonth(), 1);
  let endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  if (range === "today") {
    startDate = new Date(endDate);
  } else if (range === "7d") {
    startDate = addDaysToDate(endDate, -6);
  } else if (range === "30d") {
    startDate = addDaysToDate(endDate, -29);
  } else if (range === "thisYear") {
    startDate = new Date(today.getFullYear(), 0, 1);
  } else if (range === "lastYear") {
    startDate = new Date(today.getFullYear() - 1, 0, 1);
    endDate = new Date(today.getFullYear() - 1, 11, 31);
  } else if (range === "twoYearsAgo") {
    startDate = new Date(today.getFullYear() - 2, 0, 1);
    endDate = new Date(today.getFullYear() - 2, 11, 31);
  }

  return {
    startDate: formatDateInputValue(startDate),
    endDate: formatDateInputValue(endDate),
  };
}

function buildSeasonBands(rows) {
  if (!rows.length) {
    return [];
  }

  const bands = [];

  rows.forEach((row) => {
    const season = getSeasonForTimestamp(row.timestamp);
    const current = bands[bands.length - 1];

    if (current && current.season.key === season.key) {
      current.count += 1;
      current.end = row.timestamp;
      return;
    }

    bands.push({
      season,
      start: row.timestamp,
      end: row.timestamp,
      count: 1,
    });
  });

  return bands;
}

function summarizeSeasons(rows) {
  const seasonMap = new Map();

  rows.forEach((row) => {
    const season = getSeasonForTimestamp(row.timestamp);
    const current = seasonMap.get(season.key);

    if (!current) {
      seasonMap.set(season.key, {
        season,
        count: 1,
        start: row.timestamp,
        end: row.timestamp,
      });
      return;
    }

    current.count += 1;
    current.end = row.timestamp;
  });

  return Array.from(seasonMap.values()).map((item) => ({
    ...item,
    rangeText: `${formatShortDate(item.start)} - ${formatShortDate(item.end)}`,
  }));
}

function groupRowsBySeason(rows) {
  if (!rows.length) {
    return [];
  }

  const groups = [];

  rows.forEach((row) => {
    const season = getSeasonForTimestamp(row.timestamp);
    const current = groups[groups.length - 1];

    if (current && current.season.key === season.key) {
      current.rows.push(row);
      current.end = row.timestamp;
      return;
    }

    groups.push({
      season,
      rows: [row],
      start: row.timestamp,
      end: row.timestamp,
    });
  });

  return groups;
}

function getSeasonForTimestamp(timestamp) {
  const parsed = parseTimestamp(timestamp);
  const month = parsed === null ? inferMonthFromString(timestamp) : new Date(parsed).getMonth() + 1;

  if (month === 12 || month === 1 || month === 2) {
    return { key: "winter", ...SEASON_META.winter };
  }

  if (month >= 3 && month <= 5) {
    return { key: "spring", ...SEASON_META.spring };
  }

  if (month >= 6 && month <= 8) {
    return { key: "summer", ...SEASON_META.summer };
  }

  return { key: "autumn", ...SEASON_META.autumn };
}

function formatShortDate(timestamp) {
  const parsed = parseTimestamp(timestamp);

  if (parsed === null) {
    return timestamp;
  }

  const date = new Date(parsed);
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function formatDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysToDate(date, days) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function addDays(dateValue, days) {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() + days);
  return formatDateInputValue(date);
}

function normalizeRows(responseData) {
  const body = parseBody(responseData);
  const rows = Object.entries(body).map(([timestamp, values]) => ({
    timestamp,
    temp: toNumber(values ? values.temp : undefined),
    vwc: toNumber(values ? values.vwc : undefined),
  }));

  rows.sort((left, right) => compareTimestamps(left.timestamp, right.timestamp));
  return rows;
}

function parseBody(responseData) {
  const rawBody =
    responseData && Object.prototype.hasOwnProperty.call(responseData, "body")
      ? responseData.body
      : responseData;
  const parsedBody = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;

  if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
    throw new Error("Unexpected response body");
  }

  return parsedBody;
}

function exportVisibleRows(visibleRows, lastPayload) {
  if (!visibleRows.length || !lastPayload) {
    return;
  }

  const csvLines = [
    "season,timestamp,temp,vwc",
    ...visibleRows.map((row) => {
      const season = getSeasonForTimestamp(row.timestamp);
      return `${escapeCsv(season.label)},${escapeCsv(row.timestamp)},${row.temp ?? ""},${row.vwc ?? ""}`;
    }),
  ];

  const blob = new Blob([`${csvLines.join("\n")}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `${lastPayload.device_id}_season_view.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatMetric(value, unit) {
  return value === null ? "-" : `${value.toFixed(2)}${unit}`;
}

function formatBand(values, unit) {
  if (!values.length) {
    return "-";
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  return `${min.toFixed(1)}-${max.toFixed(1)}${unit}`;
}

function calculateAverage(values) {
  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calculateAverageGap(rows) {
  const averageMinutes = calculateAverageGapMinutes(rows);

  if (averageMinutes === null) {
    return "-";
  }

  if (averageMinutes >= 60) {
    return `${(averageMinutes / 60).toFixed(1)}시간`;
  }

  return `${averageMinutes.toFixed(1)}분`;
}

function calculateAverageGapMinutes(rows) {
  if (rows.length < 2) {
    return null;
  }

  let totalGapMinutes = 0;
  let validGaps = 0;

  for (let index = 1; index < rows.length; index += 1) {
    const previous = parseTimestamp(rows[index - 1].timestamp);
    const current = parseTimestamp(rows[index].timestamp);

    if (previous !== null && current !== null) {
      totalGapMinutes += (current - previous) / 60000;
      validGaps += 1;
    }
  }

  return validGaps ? totalGapMinutes / validGaps : null;
}

function resolveSensorName(deviceId) {
  const preset = SENSOR_PRESETS.find((item) => item.id === deviceId);
  return preset ? `${deviceId} ${preset.label}` : `Sensor ${deviceId}`;
}

function toApiDate(dateValue) {
  return dateValue.replaceAll("-", ".");
}

function parseTimestamp(value) {
  const normalized = value.replaceAll(".", "-").replace(" ", "T").replace(/\//g, "-");
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function inferMonthFromString(value) {
  const match = value.match(/(\d{2,4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  return match ? Number(match[2]) : 1;
}

function compareTimestamps(left, right) {
  const leftMillis = parseTimestamp(left);
  const rightMillis = parseTimestamp(right);

  if (leftMillis !== null && rightMillis !== null) {
    return leftMillis - rightMillis;
  }

  return left.localeCompare(right);
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isPresentNumber(value) {
  return value !== null;
}

function escapeCsv(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export default App;

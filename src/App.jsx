import { Suspense, lazy, startTransition, useDeferredValue, useEffect, useState } from "react";

const API_ENDPOINT = "https://puis3e72h4.execute-api.ap-northeast-2.amazonaws.com/dev";
const WEATHER_API_ENDPOINT = (import.meta.env.VITE_RAINFALL_API_ENDPOINT ?? "").trim();
const WEATHER_LOCATION_NAME = (import.meta.env.VITE_RAINFALL_LOCATION_NAME ?? "").trim();
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
    text: "",
    error: false,
  });
  const [rows, setRows] = useState([]);
  const [lastPayload, setLastPayload] = useState(null);
  const [rainfallSeries, setRainfallSeries] = useState([]);
  const [weather, setWeather] = useState(createInitialWeatherState);
  const [viewWindow, setViewWindow] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedMonthKey, setSelectedMonthKey] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const deferredSearchTerm = useDeferredValue(searchTerm);

  const refreshWeather = async () => {
    if (!WEATHER_API_ENDPOINT) {
      setWeather(createInitialWeatherState());
      return;
    }

    setWeather((current) => ({
      ...current,
      status: "loading",
      value: current.status === "ready" ? current.value : "...",
      subtext: "기상청 강수 데이터를 조회 중입니다.",
    }));

    try {
      const response = await fetch(WEATHER_API_ENDPOINT, {
        method: "GET",
        mode: "cors",
        cache: "no-cache",
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      setWeather(normalizeWeatherState(await response.json()));
    } catch (error) {
      console.error(error);
      setWeather({
        status: "error",
        value: "-",
        subtext: "강수 API 조회 실패",
      });
    }
  };

  useEffect(() => {
    const nextRange = buildQuickRange("month");
    setForm((current) => ({
      ...current,
      startDate: nextRange.startDate,
      endDate: nextRange.endDate,
    }));
  }, []);

  useEffect(() => {
    if (!WEATHER_API_ENDPOINT) {
      return;
    }

    void refreshWeather();
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

  const chartRows = mergeRainfallIntoRows(visibleRows, rainfallSeries);

  const metrics = deriveMetrics(rows);
  const insights = deriveInsights(rows, visibleRows, lastPayload, viewWindow, deferredSearchTerm);
  const seasonBands = buildSeasonBands(visibleRows);
  const seasonSummaries = summarizeSeasons(visibleRows);
  const monthlySummaries = buildMonthlySummaries(visibleRows);
  const monthlySummaryKeys = monthlySummaries.map((item) => item.key).join("|");
  const selectedMonth =
    monthlySummaries.find((item) => item.key === selectedMonthKey) ?? monthlySummaries[0] ?? null;

  useEffect(() => {
    if (!monthlySummaries.length) {
      setSelectedMonthKey("");
      return;
    }

    setSelectedMonthKey((current) =>
      monthlySummaries.some((item) => item.key === current) ? current : monthlySummaries[0].key,
    );
  }, [monthlySummaryKeys]);

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
    const nextForm = {
      ...form,
      startDate: range.startDate,
      endDate: range.endDate,
    };

    setActiveRange(rangeKey);
    setForm(nextForm);
    void executeQuery(nextForm);
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
    setRainfallSeries([]);
    setViewWindow("all");
    setSearchTerm("");
    setSelectedMonthKey("");
    setStatus({ label: "READY", tone: "" });
    setMessage({
      text: "기본 조회 설정으로 되돌렸습니다.",
      error: false,
    });
  };

  const executeQuery = async (targetForm) => {
    const validationError = validateForm(targetForm);
    if (validationError) {
      setStatus({ label: "INPUT ERROR", tone: "error" });
      setMessage({ text: validationError, error: true });
      return;
    }

    const payload = {
      start_date: toApiDate(targetForm.startDate),
      end_date: toApiDate(addDays(targetForm.endDate, 1)),
      device_id: targetForm.deviceId.trim(),
      rawStartDate: targetForm.startDate,
      rawEndDate: targetForm.endDate,
    };

    setIsLoading(true);
    setStatus({ label: "LOADING", tone: "loading" });
    setMessage({
      text: "원격 API에서 센서 데이터를 조회 중입니다.",
      error: false,
    });

    try {
      const [sensorResponse, rainfallData] = await Promise.all([
        fetch(API_ENDPOINT, {
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
        }),
        fetchRainfallHistory(targetForm),
      ]);

      if (!sensorResponse.ok) {
        throw new Error(`HTTP ${sensorResponse.status}`);
      }

      const data = normalizeRows(await sensorResponse.json());
      startTransition(() => {
        setRows(data);
        setLastPayload(payload);
        setRainfallSeries(rainfallData);
      });
      const fallbackWeather = deriveWeatherStateFromRainfallSeries(rainfallData);
      if (fallbackWeather) {
        startTransition(() => {
          setWeather(fallbackWeather);
        });
      }
      void refreshWeather();
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
        setRainfallSeries([]);
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

  const handleSubmit = async (event) => {
    event.preventDefault();
    await executeQuery(form);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">HDC Labs / Soil Monitoring</p>
          <h1>Sensor Trend Dashboard</h1>
          <p className="topbar-copy">적용 현장: HDC Labs 타워, 10F 옥상 정원 , 센서 2EA</p>
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
              disabled={isLoading}
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
            <span>설치 장소</span>
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
        <MetricPanel label="Rainfall" value={weather.value} subtext={weather.subtext} />
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
              <TelemetryChart data={chartRows} />
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

        <p className="support-text support-text-inline">{insights.resultsHint}</p>

        {monthlySummaries.length ? (
          <div className="monthly-layout">
            <div className="month-summary-list" role="list" aria-label="월별 요약">
              {monthlySummaries.map((month) => (
                <button
                  key={month.key}
                  type="button"
                  className={`month-card ${selectedMonth?.key === month.key ? "is-active" : ""}`.trim()}
                  onClick={() => setSelectedMonthKey(month.key)}
                >
                  <div className="month-card-head">
                    <div>
                      <strong>{month.label}</strong>
                      <span className={`season-tag ${month.season.accentClass}`.trim()}>
                        {month.season.label}
                      </span>
                    </div>
                    <em>{month.rows.length}건</em>
                  </div>
                  <p>{month.rangeText}</p>
                  <dl className="month-metrics">
                    <div>
                      <dt>Temperature</dt>
                      <dd>{month.tempBand}</dd>
                    </div>
                    <div>
                      <dt>VWC</dt>
                      <dd>{month.vwcBand}</dd>
                    </div>
                  </dl>
                </button>
              ))}
            </div>

            <div className="month-detail-panel">
              {selectedMonth ? (
                <>
                  <div className="month-detail-head">
                    <div>
                      <p className="section-kicker">Selected Month</p>
                      <h3>{selectedMonth.label}</h3>
                    </div>
                    <div className="month-detail-meta">
                      <span className={`season-tag ${selectedMonth.season.accentClass}`.trim()}>
                        {selectedMonth.season.label}
                      </span>
                      <span>{selectedMonth.rows.length}건</span>
                      <span>{selectedMonth.rangeText}</span>
                    </div>
                  </div>

                  <div className="table-wrap compact-table-wrap">
                    <table className="compact-table">
                      <thead>
                        <tr>
                          <th scope="col">계절</th>
                          <th scope="col">Timestamp</th>
                          <th scope="col">Temperature</th>
                          <th scope="col">VWC</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedMonth.rows.map((row) => {
                          const season = getSeasonForTimestamp(row.timestamp);

                          return (
                            <tr key={`${selectedMonth.key}-${row.timestamp}`}>
                              <td>
                                <span className={`season-tag ${season.accentClass}`.trim()}>
                                  {season.label}
                                </span>
                              </td>
                              <td>{row.timestamp}</td>
                              <td>{formatMetric(row.temp, "°C")}</td>
                              <td>{formatMetric(row.vwc, "%")}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <EmptyPanel message="선택된 월이 없습니다." />
              )}
            </div>
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

function createInitialWeatherState() {
  if (!WEATHER_API_ENDPOINT) {
    return {
      status: "disabled",
      value: "연동 전",
      subtext: "VITE_RAINFALL_API_ENDPOINT 설정 필요",
    };
  }

  return {
    status: "idle",
    value: "-",
    subtext: "기상청 강수 데이터 대기 중",
  };
}

async function fetchRainfallHistory(targetForm) {
  if (!WEATHER_API_ENDPOINT) {
    return [];
  }

  const requestUrl = new URL(WEATHER_API_ENDPOINT);
  requestUrl.searchParams.set("startDate", targetForm.startDate);
  requestUrl.searchParams.set("endDate", targetForm.endDate);

  const response = await fetch(requestUrl, {
    method: "GET",
    mode: "cors",
    cache: "no-cache",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Rainfall HTTP ${response.status}`);
  }

  const payload = await response.json();
  return normalizeRainfallSeries(payload);
}

function normalizeWeatherState(payload) {
  const rainfall = payload?.precipitation;
  const locationName = payload?.location?.name || WEATHER_LOCATION_NAME || "서울";
  const observedAt = payload?.observedAt || payload?.source?.observedAt;

  return {
    status: "ready",
    value: rainfall?.displayValue || formatRainfallValue(rainfall?.value, rainfall?.unit),
    subtext: observedAt ? `${locationName} | ${observedAt}` : `${locationName} | 현재 강수량`,
  };
}

function normalizeRainfallSeries(payload) {
  const series = Array.isArray(payload?.series) ? payload.series : [];

  return series
    .map((item) => ({
      timestamp: item.timestamp,
      rainfall: typeof item.rainfall === "number" ? item.rainfall : toNumber(item.rainfall),
    }))
    .filter((item) => item.timestamp);
}

function deriveWeatherStateFromRainfallSeries(series) {
  if (!Array.isArray(series) || !series.length) {
    return null;
  }

  const latestItem = [...series]
    .filter((item) => item.timestamp)
    .sort((left, right) => compareTimestamps(left.timestamp, right.timestamp))
    .at(-1);

  if (!latestItem) {
    return null;
  }

  const latestValue =
    latestItem.rainfall === null || latestItem.rainfall === undefined
      ? "-"
      : formatRainfallValue(latestItem.rainfall);

  return {
    status: "ready",
    value: latestValue,
    subtext: `${WEATHER_LOCATION_NAME || "서울"} | ${latestItem.timestamp}`,
  };
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
      summary: "데이터를 조회하면 센서 데이터 차트와 상세 측정값이 여기에 표시됩니다.",
      resultsHint: "조회 후 아래에서 월별 최소~최대와 선택한 달 상세 데이터를 볼 수 있습니다.",
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
    resultsHint: `${visibleRows.length}건 기준으로 월별 최소~최대 요약을 만들었습니다. 원하는 달을 눌러 우측 상세 목록을 확인하세요.`,
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

function buildMonthlySummaries(rows) {
  if (!rows.length) {
    return [];
  }

  const monthMap = new Map();

  rows.forEach((row) => {
    const key = getMonthKey(row.timestamp);

    if (!key) {
      return;
    }

    const existing = monthMap.get(key);

    if (existing) {
      existing.rows.push(row);
      if (compareTimestamps(row.timestamp, existing.start) < 0) {
        existing.start = row.timestamp;
      }
      if (compareTimestamps(row.timestamp, existing.end) > 0) {
        existing.end = row.timestamp;
      }
      return;
    }

    monthMap.set(key, {
      key,
      label: formatMonthLabel(key),
      season: getSeasonForTimestamp(row.timestamp),
      rows: [row],
      start: row.timestamp,
      end: row.timestamp,
    });
  });

  return Array.from(monthMap.values())
    .map((item) => {
      const temps = item.rows.map((row) => row.temp).filter(isValidSummaryNumber);
      const vwcs = item.rows.map((row) => row.vwc).filter(isValidSummaryNumber);

      return {
        ...item,
        rows: [...item.rows].sort((left, right) => compareTimestamps(right.timestamp, left.timestamp)),
        rangeText: `${formatShortDate(item.start)} - ${formatShortDate(item.end)}`,
        tempBand: formatBand(temps, "°C"),
        vwcBand: formatBand(vwcs, "%"),
      };
    })
    .sort((left, right) => right.key.localeCompare(left.key));
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

function formatMonthLabel(monthKey) {
  const [year, month] = monthKey.split("-");
  return `${year}년 ${Number(month)}월`;
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
  const rows = Object.entries(body)
    .map(([timestamp, values]) => ({
      timestamp,
      temp: toNumber(values ? values.temp : undefined),
      vwc: toNumber(values ? values.vwc : undefined),
    }))
    .filter((row) => !(row.temp === 0 && row.vwc === 0));

  rows.sort((left, right) => compareTimestamps(left.timestamp, right.timestamp));
  return rows;
}

function mergeRainfallIntoRows(rows, rainfallSeries) {
  if (!rows.length) {
    return [];
  }

  const rainfallMap = new Map(
    rainfallSeries.map((item) => [toHourBucket(item.timestamp), item.rainfall]),
  );

  return rows.map((row) => ({
    ...row,
    rainfall: rainfallMap.get(toHourBucket(row.timestamp)) ?? null,
  }));
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

function formatRainfallValue(value, unit = "mm") {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return `${value.toFixed(1)} ${unit}`;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed.toFixed(1)} ${unit}` : String(value);
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
  const normalized = normalizeTimestamp(value);
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function toHourBucket(value) {
  const parsed = parseTimestamp(value);

  if (parsed !== null) {
    const date = new Date(parsed);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
      date.getDate(),
    ).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:00`;
  }

  const match = String(value).match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})[ T-](\d{1,2})/);
  if (!match) {
    return String(value);
  }

  return `${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(
    Number(match[3]),
  ).padStart(2, "0")} ${String(Number(match[4])).padStart(2, "0")}:00`;
}

function normalizeTimestamp(value) {
  const base = String(value).trim().replaceAll("/", "-").replaceAll(".", "-");
  return base.replace(/^(\d{4}-\d{2}-\d{2})[-\s](\d{2}:\d{2}(?::\d{2})?)$/, "$1T$2");
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

function getMonthKey(timestamp) {
  const parsed = parseTimestamp(timestamp);

  if (parsed !== null) {
    const date = new Date(parsed);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  const match = timestamp.match(/(\d{4})[.\-/](\d{1,2})/);
  if (!match) {
    return "";
  }

  return `${match[1]}-${String(Number(match[2])).padStart(2, "0")}`;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isPresentNumber(value) {
  return value !== null;
}

function isValidSummaryNumber(value) {
  return value !== null && value > 0;
}

function escapeCsv(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export default App;

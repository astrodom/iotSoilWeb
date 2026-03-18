const API_ENDPOINT = "https://puis3e72h4.execute-api.ap-northeast-2.amazonaws.com/dev";
const SENSOR_PRESETS = [
    { id: "22096028", label: "lounge 앞 화단" },
    { id: "22096027", label: "원형 화단" },
];

const state = {
    chart: null,
    controller: null,
    rows: [],
};

const elements = {
    queryForm: document.getElementById("queryForm"),
    startDate: document.getElementById("startDate"),
    endDate: document.getElementById("endDate"),
    sensorPreset: document.getElementById("sensorPreset"),
    deviceId: document.getElementById("deviceId"),
    queryButton: document.getElementById("queryButton"),
    resetButton: document.getElementById("resetButton"),
    formMessage: document.getElementById("formMessage"),
    statusBadge: document.getElementById("statusBadge"),
    querySummary: document.getElementById("querySummary"),
    sampleCount: document.getElementById("sampleCount"),
    latestTemp: document.getElementById("latestTemp"),
    latestVwc: document.getElementById("latestVwc"),
    averageTemp: document.getElementById("averageTemp"),
    emptyState: document.getElementById("emptyState"),
    tableWrap: document.getElementById("tableWrap"),
    resultsTableBody: document.getElementById("resultsTableBody"),
    sensorChart: document.getElementById("sensorChart"),
};

initializeDashboard();

function initializeDashboard() {
    applyDefaultDates();
    elements.deviceId.value = SENSOR_PRESETS[0].id;
    elements.sensorPreset.value = SENSOR_PRESETS[0].id;
    elements.queryForm.addEventListener("submit", handleSubmit);
    elements.resetButton.addEventListener("click", resetDashboard);
    elements.sensorPreset.addEventListener("change", syncPresetToDevice);
    elements.deviceId.addEventListener("input", syncDeviceToPreset);
    renderEmptyState();
}

function applyDefaultDates() {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    elements.startDate.value = formatDateInputValue(firstDay);
    elements.endDate.value = formatDateInputValue(today);
}

function formatDateInputValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function syncPresetToDevice() {
    if (elements.sensorPreset.value) {
        elements.deviceId.value = elements.sensorPreset.value;
    }
}

function syncDeviceToPreset() {
    const matchingPreset = SENSOR_PRESETS.find((preset) => preset.id === elements.deviceId.value.trim());
    elements.sensorPreset.value = matchingPreset ? matchingPreset.id : "";
}

async function handleSubmit(event) {
    event.preventDefault();

    const validationError = validateForm();
    if (validationError) {
        setFormMessage(validationError, true);
        setStatus("입력 오류", "error");
        return;
    }

    if (typeof window.Chart !== "function") {
        setFormMessage("Chart.js를 불러오지 못했습니다. 네트워크 연결을 확인하세요.", true);
        setStatus("Chart 오류", "error");
        return;
    }

    const requestPayload = buildRequestPayload();
    await fetchSensorData(requestPayload);
}

function validateForm() {
    const startDate = elements.startDate.value;
    const endDate = elements.endDate.value;
    const deviceId = elements.deviceId.value.trim();

    if (!startDate || !endDate) {
        return "시작일과 종료일을 모두 입력해야 합니다.";
    }

    if (startDate > endDate) {
        return "시작일은 종료일보다 늦을 수 없습니다.";
    }

    if (!/^\d{6,}$/.test(deviceId)) {
        return "센서 ID는 숫자 6자리 이상으로 입력하세요.";
    }

    return "";
}

function buildRequestPayload() {
    return {
        start_date: toApiDate(elements.startDate.value),
        end_date: toApiDate(addDays(elements.endDate.value, 1)),
        device_id: elements.deviceId.value.trim(),
        rawStartDate: elements.startDate.value,
        rawEndDate: elements.endDate.value,
    };
}

function toApiDate(dateValue) {
    return dateValue.replaceAll("-", ".");
}

function addDays(dateValue, days) {
    const date = new Date(`${dateValue}T00:00:00`);
    date.setDate(date.getDate() + days);
    return formatDateInputValue(date);
}

async function fetchSensorData(payload) {
    if (state.controller) {
        state.controller.abort();
    }

    state.controller = new AbortController();
    setBusy(true);
    setStatus("Loading", "loading");
    setFormMessage("원격 API에서 데이터를 조회 중입니다.", false);

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
            signal: state.controller.signal,
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const responseData = await response.json();
        state.rows = normalizeRows(responseData);
        renderResults(payload);
        setStatus("Success", "");
        setFormMessage(`센서 ${payload.device_id} 데이터를 성공적으로 불러왔습니다.`, false);
    } catch (error) {
        if (error.name === "AbortError") {
            return;
        }

        console.error(error);
        state.rows = [];
        renderEmptyState();
        setStatus("Request failed", "error");
        setFormMessage("데이터를 불러오지 못했습니다. API 상태, CORS 설정, 응답 형식을 확인하세요.", true);
    } finally {
        setBusy(false);
        state.controller = null;
    }
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
    const rawBody = responseData && Object.prototype.hasOwnProperty.call(responseData, "body")
        ? responseData.body
        : responseData;

    const parsedBody = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
    if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
        throw new Error("Unexpected response body");
    }

    return parsedBody;
}

function toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function compareTimestamps(left, right) {
    const leftMillis = parseTimestamp(left);
    const rightMillis = parseTimestamp(right);

    if (leftMillis !== null && rightMillis !== null) {
        return leftMillis - rightMillis;
    }

    return left.localeCompare(right);
}

function parseTimestamp(value) {
    const normalized = value
        .replaceAll(".", "-")
        .replace(" ", "T")
        .replace(/\//g, "-");
    const parsed = Date.parse(normalized);
    return Number.isNaN(parsed) ? null : parsed;
}

function renderResults(payload) {
    if (!state.rows.length) {
        renderEmptyState("선택한 조건에 해당하는 데이터가 없습니다.");
        return;
    }

    renderMetrics();
    renderSummary(payload);
    renderTable();
    renderChart();
}

function renderMetrics() {
    const lastRow = state.rows[state.rows.length - 1];
    const validTemps = state.rows.map((row) => row.temp).filter((value) => value !== null);
    const averageTemp = validTemps.length
        ? validTemps.reduce((sum, value) => sum + value, 0) / validTemps.length
        : null;

    elements.sampleCount.textContent = String(state.rows.length);
    elements.latestTemp.textContent = formatMetric(lastRow.temp, "°C");
    elements.latestVwc.textContent = formatMetric(lastRow.vwc, "%");
    elements.averageTemp.textContent = formatMetric(averageTemp, "°C");
}

function renderSummary(payload) {
    const sensorName = resolveSensorName(payload.device_id);
    const firstTimestamp = state.rows[0].timestamp;
    const lastTimestamp = state.rows[state.rows.length - 1].timestamp;
    elements.querySummary.textContent =
        `${sensorName} | ${payload.start_date} ~ ${toApiDate(payload.rawEndDate)} | ${state.rows.length} samples | ${firstTimestamp} -> ${lastTimestamp}`;
}

function resolveSensorName(deviceId) {
    const preset = SENSOR_PRESETS.find((item) => item.id === deviceId);
    return preset ? `${deviceId} ${preset.label}` : `Sensor ${deviceId}`;
}

function renderTable() {
    const rowsHtml = state.rows.map((row) => {
        const tr = document.createElement("tr");
        const timestampCell = document.createElement("td");
        const tempCell = document.createElement("td");
        const vwcCell = document.createElement("td");

        timestampCell.textContent = row.timestamp;
        tempCell.textContent = formatMetric(row.temp, "°C");
        vwcCell.textContent = formatMetric(row.vwc, "%");

        tr.append(timestampCell, tempCell, vwcCell);
        return tr;
    });

    elements.resultsTableBody.replaceChildren(...rowsHtml);
    elements.emptyState.hidden = true;
    elements.tableWrap.hidden = false;
}

function renderChart() {
    if (state.chart) {
        state.chart.destroy();
    }

    state.chart = new window.Chart(elements.sensorChart, {
        type: "line",
        data: {
            labels: state.rows.map((row) => row.timestamp),
            datasets: [
                {
                    label: "Temperature",
                    data: state.rows.map((row) => row.temp),
                    borderColor: "#2e6a4b",
                    backgroundColor: "rgba(46, 106, 75, 0.18)",
                    borderWidth: 2,
                    pointRadius: 1.5,
                    pointHoverRadius: 4,
                    tension: 0.28,
                    yAxisID: "y",
                },
                {
                    label: "VWC",
                    data: state.rows.map((row) => row.vwc),
                    borderColor: "#bd7b35",
                    backgroundColor: "rgba(189, 123, 53, 0.18)",
                    borderWidth: 2,
                    pointRadius: 1.5,
                    pointHoverRadius: 4,
                    tension: 0.28,
                    yAxisID: "y1",
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: "index",
                intersect: false,
            },
            plugins: {
                legend: {
                    position: "bottom",
                },
                tooltip: {
                    callbacks: {
                        label(context) {
                            const unit = context.dataset.yAxisID === "y1" ? "%" : "°C";
                            return `${context.dataset.label}: ${context.formattedValue}${unit}`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    ticks: {
                        maxRotation: 0,
                        autoSkip: true,
                        color: "#6d6255",
                    },
                    grid: {
                        color: "rgba(73, 58, 35, 0.08)",
                    },
                },
                y: {
                    position: "left",
                    ticks: {
                        color: "#2e6a4b",
                    },
                    grid: {
                        color: "rgba(73, 58, 35, 0.08)",
                    },
                },
                y1: {
                    position: "right",
                    ticks: {
                        color: "#bd7b35",
                    },
                    grid: {
                        drawOnChartArea: false,
                    },
                },
            },
        },
    });
}

function renderEmptyState(message) {
    elements.emptyState.hidden = false;
    elements.tableWrap.hidden = true;
    elements.resultsTableBody.replaceChildren();
    elements.querySummary.textContent = message || "데이터를 조회하면 차트와 상세 테이블이 표시됩니다.";
    elements.sampleCount.textContent = "0";
    elements.latestTemp.textContent = "-";
    elements.latestVwc.textContent = "-";
    elements.averageTemp.textContent = "-";

    const paragraph = document.createElement("p");
    paragraph.textContent = message || "조회 전입니다. 날짜와 센서 ID를 선택한 뒤 데이터를 불러오세요.";
    elements.emptyState.replaceChildren(paragraph);

    if (state.chart) {
        state.chart.destroy();
        state.chart = null;
    }
}

function formatMetric(value, unit) {
    return value === null ? "-" : `${value.toFixed(2)}${unit}`;
}

function setFormMessage(message, isError) {
    elements.formMessage.textContent = message;
    elements.formMessage.classList.toggle("error", Boolean(isError));
}

function setStatus(label, tone) {
    elements.statusBadge.textContent = label;
    elements.statusBadge.classList.remove("loading", "error");
    if (tone) {
        elements.statusBadge.classList.add(tone);
    }
}

function setBusy(isBusy) {
    elements.queryButton.disabled = isBusy;
    elements.resetButton.disabled = isBusy;
    elements.queryButton.textContent = isBusy ? "조회 중..." : "조회";
}

function resetDashboard() {
    if (state.controller) {
        state.controller.abort();
        state.controller = null;
    }

    applyDefaultDates();
    elements.sensorPreset.value = SENSOR_PRESETS[0].id;
    elements.deviceId.value = SENSOR_PRESETS[0].id;
    setFormMessage("날짜와 센서 ID를 기본값으로 되돌렸습니다.", false);
    setStatus("Ready", "");
    renderEmptyState();
}

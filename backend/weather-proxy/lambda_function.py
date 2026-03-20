import json
import os
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode, unquote
from urllib.request import Request, urlopen

KMA_API_BASE = os.environ.get(
    "KMA_API_BASE",
    "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst",
)
KMA_ASOS_API_BASE = os.environ.get(
    "KMA_ASOS_API_BASE",
    "https://apis.data.go.kr/1360000/AsosHourlyInfoService/getWthrDataList",
)
KST = timezone(timedelta(hours=9))


def lambda_handler(event: Optional[Dict[str, Any]], context: Any) -> Dict[str, Any]:
    del context

    if is_options_request(event):
        return respond(204, "")

    service_key = normalize_service_key(os.environ.get("KMA_SERVICE_KEY", ""))
    if not service_key:
        return respond(
            500,
            {
                "ok": False,
                "error": "KMA_SERVICE_KEY is not configured.",
            },
        )

    query = (event or {}).get("queryStringParameters") or {}
    nx = to_integer(query.get("nx") or os.environ.get("KMA_DEFAULT_NX"))
    ny = to_integer(query.get("ny") or os.environ.get("KMA_DEFAULT_NY"))
    asos_station_id = (
        query.get("stnIds")
        or query.get("stationId")
        or os.environ.get("KMA_ASOS_STN_ID")
        or "108"
    )
    lookback_hours = max(to_integer(os.environ.get("KMA_LOOKBACK_HOURS")) or 8, 1)
    location_name = query.get("locationName") or os.environ.get("LOCATION_NAME") or "서울"
    start_date = query.get("startDate")
    end_date = query.get("endDate")

    if start_date and end_date:
        return handle_range_request(
            service_key=service_key,
            station_id=asos_station_id,
            start_date=start_date,
            end_date=end_date,
            location_name=location_name,
            nx=nx,
            ny=ny,
            lookback_hours=lookback_hours,
        )

    if nx is None or ny is None:
        return respond(
            400,
            {
                "ok": False,
                "error": "nx and ny are required. Provide query params or KMA_DEFAULT_NX/KMA_DEFAULT_NY env vars.",
            },
        )

    try:
        for candidate in build_base_time_candidates(datetime.now(tz=KST), lookback_hours):
            payload = request_ultra_short_nowcast(
                service_key=service_key,
                nx=nx,
                ny=ny,
                base_date=candidate["baseDate"],
                base_time=candidate["baseTime"],
            )
            rainfall = find_rainfall_item(payload)

            if rainfall is None:
                continue

            return respond(
                200,
                {
                    "ok": True,
                    "location": {
                        "name": location_name,
                        "nx": nx,
                        "ny": ny,
                    },
                    "observedAt": format_observed_at(
                        candidate["baseDate"], candidate["baseTime"]
                    ),
                    "precipitation": {
                        "label": "1시간 강수량",
                        "value": to_numeric_or_string(rainfall.get("obsrValue")),
                        "unit": "mm",
                        "displayValue": format_rainfall_display(rainfall.get("obsrValue")),
                    },
                    "source": {
                        "provider": "KMA",
                        "dataset": "getUltraSrtNcst",
                        "baseDate": candidate["baseDate"],
                        "baseTime": candidate["baseTime"],
                        "category": "RN1",
                    },
                },
            )

        return respond(
            502,
            {
                "ok": False,
                "error": "RN1 observation was not found within the lookback window.",
                "location": {
                    "name": location_name,
                    "nx": nx,
                    "ny": ny,
                },
            },
        )
    except Exception as error:  # pylint: disable=broad-except
        print(error)
        return respond(
            502,
            {
                "ok": False,
                "error": str(error) or "KMA request failed.",
            },
        )


def handle_range_request(
    *,
    service_key: str,
    station_id: str,
    start_date: str,
    end_date: str,
    location_name: str,
    nx: Optional[int],
    ny: Optional[int],
    lookback_hours: int,
) -> Dict[str, Any]:
    start = parse_date_string(start_date)
    end = parse_date_string(end_date)

    if start is None or end is None:
        return respond(
            400,
            {
                "ok": False,
                "error": "startDate and endDate must be provided in YYYY-MM-DD format.",
            },
        )

    if start > end:
        return respond(
            400,
            {
                "ok": False,
                "error": "startDate must not be later than endDate.",
            },
        )

    try:
        today = datetime.now(tz=KST).date()
        yesterday = today - timedelta(days=1)
        effective_asos_end = min(end, yesterday)
        rainfall_series: List[Dict[str, Any]] = []
        notices: List[str] = []

        if end > yesterday:
            notices.append("ASOS 시간자료는 전날까지 제공되어 오늘 데이터는 현재 강수량 기준으로 보완됩니다.")

        if start <= effective_asos_end:
            rainfall_series = request_asos_range_series(
                service_key=service_key,
                station_id=station_id,
                start_date=start,
                end_date=effective_asos_end,
            )

        if end >= today and nx is not None and ny is not None:
            current_point = request_current_rainfall_point(
                service_key=service_key,
                nx=nx,
                ny=ny,
                lookback_hours=lookback_hours,
            )
            if current_point is not None:
                rainfall_series.append(current_point)

        rainfall_series = dedupe_series_by_timestamp(rainfall_series)

        return respond(
            200,
            {
                "ok": True,
                "mode": "range",
                "location": {
                    "name": location_name,
                    "stationId": station_id,
                },
                "period": {
                    "startDate": start_date,
                    "endDate": end_date,
                    "effectiveAsosEndDate": effective_asos_end.strftime("%Y-%m-%d")
                    if start <= effective_asos_end
                    else None,
                },
                "series": rainfall_series,
                "notices": notices,
                "source": {
                    "provider": "KMA",
                    "dataset": "getWthrDataList",
                    "stationId": station_id,
                    "category": "rn",
                },
            },
        )
    except Exception as error:  # pylint: disable=broad-except
        print(error)
        return respond(
            502,
            {
                "ok": False,
                "error": str(error) or "KMA ASOS request failed.",
                "mode": "range",
            },
        )


def is_options_request(event: Optional[Dict[str, Any]]) -> bool:
    if not event:
        return False

    http_method = event.get("httpMethod")
    request_method = (
        event.get("requestContext", {})
        .get("http", {})
        .get("method")
    )
    return http_method == "OPTIONS" or request_method == "OPTIONS"


def request_ultra_short_nowcast(
    *, service_key: str, nx: int, ny: int, base_date: str, base_time: str
) -> Dict[str, Any]:
    query = urlencode(
        {
            "serviceKey": service_key,
            "pageNo": "1",
            "numOfRows": "1000",
            "dataType": "JSON",
            "base_date": base_date,
            "base_time": base_time,
            "nx": str(nx),
            "ny": str(ny),
        }
    )
    request = Request(
        f"{KMA_API_BASE}?{query}",
        headers={"Accept": "application/json"},
        method="GET",
    )

    with urlopen(request, timeout=10) as response:
        status_code = getattr(response, "status", response.getcode())
        if status_code != 200:
            raise RuntimeError(f"KMA API responded with HTTP {status_code}")

        payload = json.loads(response.read().decode("utf-8"))

    result_code = (((payload.get("response") or {}).get("header") or {}).get("resultCode"))
    if result_code != "00":
        result_msg = (((payload.get("response") or {}).get("header") or {}).get("resultMsg")) or "Unknown error"
        raise RuntimeError(f"KMA API error {result_code}: {result_msg}")

    return payload


def request_asos_hourly_rainfall(
    *, service_key: str, station_id: str, start_date: str, end_date: str
) -> Dict[str, Any]:
    query = urlencode(
        {
            "serviceKey": service_key,
            "pageNo": "1",
            "numOfRows": "999",
            "dataType": "JSON",
            "dataCd": "ASOS",
            "dateCd": "HR",
            "startDt": start_date,
            "startHh": "00",
            "endDt": end_date,
            "endHh": "23",
            "stnIds": station_id,
        }
    )
    request = Request(
        f"{KMA_ASOS_API_BASE}?{query}",
        headers={"Accept": "application/json"},
        method="GET",
    )

    with urlopen(request, timeout=15) as response:
        status_code = getattr(response, "status", response.getcode())
        if status_code != 200:
            raise RuntimeError(f"KMA ASOS API responded with HTTP {status_code}")

        payload = json.loads(response.read().decode("utf-8"))

    result_code = (((payload.get("response") or {}).get("header") or {}).get("resultCode"))
    if result_code != "00":
        result_msg = (((payload.get("response") or {}).get("header") or {}).get("resultMsg")) or "Unknown error"
        raise RuntimeError(f"KMA ASOS API error {result_code}: {result_msg}")

    return payload


def request_asos_range_series(
    *, service_key: str, station_id: str, start_date: date, end_date: date
) -> List[Dict[str, Any]]:
    combined: List[Dict[str, Any]] = []

    for chunk_start, chunk_end in split_date_range(start_date, end_date, 30):
        payload = request_asos_hourly_rainfall(
            service_key=service_key,
            station_id=station_id,
            start_date=chunk_start.strftime("%Y%m%d"),
            end_date=chunk_end.strftime("%Y%m%d"),
        )
        combined.extend(build_rainfall_series(payload))

    return combined


def request_current_rainfall_point(
    *, service_key: str, nx: int, ny: int, lookback_hours: int
) -> Optional[Dict[str, Any]]:
    for candidate in build_base_time_candidates(datetime.now(tz=KST), lookback_hours):
        payload = request_ultra_short_nowcast(
            service_key=service_key,
            nx=nx,
            ny=ny,
            base_date=candidate["baseDate"],
            base_time=candidate["baseTime"],
        )
        rainfall = find_rainfall_item(payload)

        if rainfall is None:
            continue

        return {
            "timestamp": format_hour_timestamp(candidate["baseDate"], candidate["baseTime"]),
            "rainfall": to_float_or_none(rainfall.get("obsrValue")),
            "stationId": None,
            "stationName": None,
        }

    return None


def find_rainfall_item(payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    items = ((((payload.get("response") or {}).get("body") or {}).get("items") or {}).get("item"))
    if not isinstance(items, list):
        return None

    for item in items:
        if item.get("category") == "RN1":
            return item

    return None


def build_rainfall_series(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    items = ((((payload.get("response") or {}).get("body") or {}).get("items") or {}).get("item"))
    if not isinstance(items, list):
        return []

    series = []
    for item in items:
        timestamp = item.get("tm")
        if not timestamp:
            continue

        series.append(
            {
                "timestamp": timestamp,
                "rainfall": to_float_or_none(item.get("rn")),
                "stationId": item.get("stnId"),
                "stationName": item.get("stnNm"),
            }
        )

    return series


def dedupe_series_by_timestamp(series: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    unique: Dict[str, Dict[str, Any]] = {}

    for item in series:
        timestamp = item.get("timestamp")
        if timestamp:
            unique[timestamp] = item

    return [unique[key] for key in sorted(unique.keys())]


def build_base_time_candidates(now: datetime, lookback_hours: int) -> List[Dict[str, str]]:
    candidates = []

    for offset in range(lookback_hours):
        shifted = now - timedelta(hours=offset)
        candidates.append(
            {
                "baseDate": shifted.strftime("%Y%m%d"),
                "baseTime": shifted.strftime("%H00"),
            }
        )

    return candidates


def normalize_date_string(value: str) -> str:
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d")
        return parsed.strftime("%Y%m%d")
    except ValueError:
        return ""


def parse_date_string(value: str) -> Optional[date]:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def split_date_range(start_date: date, end_date: date, chunk_days: int) -> List[tuple[date, date]]:
    chunks = []
    current = start_date

    while current <= end_date:
        current_end = min(current + timedelta(days=chunk_days - 1), end_date)
        chunks.append((current, current_end))
        current = current_end + timedelta(days=1)

    return chunks


def format_hour_timestamp(base_date: str, base_time: str) -> str:
    return f"{base_date[:4]}-{base_date[4:6]}-{base_date[6:8]} {base_time[:2]}:00"


def format_observed_at(base_date: str, base_time: str) -> str:
    return f"{base_date[:4]}-{base_date[4:6]}-{base_date[6:8]} {base_time[:2]}:{base_time[2:4]} KST"


def format_rainfall_display(value: Any) -> str:
    if value in (None, ""):
        return "-"

    try:
        return f"{float(value):.1f} mm"
    except (TypeError, ValueError):
        return str(value)


def normalize_service_key(value: str) -> str:
    if not value:
        return ""

    try:
        return unquote(value)
    except Exception:  # pylint: disable=broad-except
        return value


def to_numeric_or_string(value: Any) -> Any:
    try:
        return float(value)
    except (TypeError, ValueError):
        return value


def to_float_or_none(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def to_integer(value: Any) -> Optional[int]:
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return None


def respond(status_code: int, body: Any) -> Dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": {
            "Access-Control-Allow-Origin": os.environ.get("ALLOW_ORIGIN", "*"),
            "Access-Control-Allow-Methods": "GET,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Cache-Control": "no-store",
            "Content-Type": "application/json; charset=utf-8",
        },
        "body": body if isinstance(body, str) else json.dumps(body, ensure_ascii=False),
    }

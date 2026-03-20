import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode, unquote
from urllib.request import Request, urlopen

KMA_API_BASE = os.environ.get(
    "KMA_API_BASE",
    "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst",
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
    lookback_hours = max(to_integer(os.environ.get("KMA_LOOKBACK_HOURS")) or 8, 1)
    location_name = query.get("locationName") or os.environ.get("LOCATION_NAME") or "서울"

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


def find_rainfall_item(payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    items = ((((payload.get("response") or {}).get("body") or {}).get("items") or {}).get("item"))
    if not isinstance(items, list):
        return None

    for item in items:
        if item.get("category") == "RN1":
            return item

    return None


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

# weather-proxy

기상청 강수량 데이터를 프런트에 CORS 가능한 JSON으로 넘기는 AWS Lambda 함수입니다.

- 기본 호출: 초단기실황 `RN1` 현재 강수량
- `startDate`, `endDate`를 넘기면: 서울 ASOS 108 기준 시간 강수량 시계열

## Required env vars

- `KMA_SERVICE_KEY`: 공공데이터포털에서 발급받은 기상청 API 서비스키

## Optional env vars

- `KMA_DEFAULT_NX`: 기본 기상청 격자 X
- `KMA_DEFAULT_NY`: 기본 기상청 격자 Y
- `KMA_ASOS_STN_ID`: 기간 조회용 ASOS 지점번호, 기본값 `108`
- `LOCATION_NAME`: 응답에 표시할 위치명
- `ALLOW_ORIGIN`: CORS 허용 origin, 기본값 `*`
- `KMA_LOOKBACK_HOURS`: 최근 몇 시간까지 역추적할지, 기본값 `8`
- `KMA_API_BASE`: 기본값은 기상청 `getUltraSrtNcst`

## API Gateway route

- Method: `GET`
- Route example: `/weather/current`
- Lambda proxy integration 사용

Query string으로 `nx`, `ny`, `locationName`, `startDate`, `endDate`, `stnIds`를 넘기면 env var보다 우선합니다.

## Sample response

```json
{
  "ok": true,
  "location": {
    "name": "서울",
    "nx": 60,
    "ny": 127
  },
  "observedAt": "2026-03-20 09:00 KST",
  "precipitation": {
    "label": "1시간 강수량",
    "value": 0,
    "unit": "mm",
    "displayValue": "0.0 mm"
  },
  "source": {
    "provider": "KMA",
    "dataset": "getUltraSrtNcst",
    "baseDate": "20260320",
    "baseTime": "0900",
    "category": "RN1"
  }
}
```

기간 조회 예시:

```text
GET /weather/current?startDate=2026-03-01&endDate=2026-03-20
```

응답 형식:

```json
{
  "ok": true,
  "mode": "range",
  "location": {
    "name": "HDC Labs 타워",
    "stationId": "108"
  },
  "period": {
    "startDate": "2026-03-01",
    "endDate": "2026-03-20"
  },
  "series": [
    {
      "timestamp": "2026-03-20 21:00",
      "rainfall": 0.0
    }
  ]
}
```

## Frontend wiring

Vite env에 아래를 넣으면 프런트 카드가 자동으로 조회합니다.

```bash
VITE_RAINFALL_API_ENDPOINT=https://your-api-id.execute-api.ap-northeast-2.amazonaws.com/prod/weather/current
VITE_RAINFALL_LOCATION_NAME=HDC Labs 타워
```

## Deploy outline

1. Lambda 런타임을 `Python 3.12` 이상으로 생성
2. `lambda_function.py` 업로드
3. Handler를 `lambda_function.lambda_handler`로 설정
4. 위 env vars 설정
5. API Gateway `GET /weather/current`를 Lambda proxy integration으로 연결
6. CORS 허용
7. 프런트 `VITE_RAINFALL_API_ENDPOINT`에 배포 URL 연결

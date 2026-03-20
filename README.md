# iotSoilWeb

토양 센서 데이터를 AWS API Gateway에서 조회해 시각화하는 React 기반 HUD 대시보드입니다.

## Stack

- React
- Vite
- Recharts

## Files

- `index.html`: Vite entry
- `package.json`: React/Vite dependencies와 scripts
- `vite.config.js`: Vite config
- `src/main.jsx`: React bootstrap
- `src/App.jsx`: HUD UI, 상태 관리, API 호출, 데이터 계산
- `src/styles.css`: HUD 스타일과 반응형 레이아웃
- `backend/weather-proxy/lambda_function.py`: 기상청 강수량 프록시 Lambda
- `backend/weather-proxy/README.md`: Lambda / API Gateway 연결 가이드
- `index_bak_20230620B.html`: 기존 백업 페이지

## Run

```bash
cd /Users/astro/Workspace/AWS/IoTSensorSoil/iotSoilWeb
npm install
npm run dev
```

프로덕션 빌드:

```bash
npm run build
```

## Behavior

- 시작일과 종료일은 브라우저의 `date` 입력을 사용합니다.
- 빠른 기간 버튼으로 오늘, 최근 7일, 최근 30일, 이번 달을 즉시 선택할 수 있습니다.
- 센서 바로가기 카드로 프리셋 센서를 즉시 전환할 수 있습니다.
- 전체 화면은 미래형 모니터링 콘솔처럼 동작하도록 HUD 패널 기반으로 구성했습니다.
- API 요청 시 날짜는 `yyyy.mm.dd` 형식으로 변환됩니다.
- 종료일은 inclusive 조회를 위해 내부적으로 하루를 더해 전송합니다.
- 조회 결과는 요약 메트릭, 전폭 추이 차트, 계절 구간, 상세 테이블에 동시에 반영됩니다.
- 조회 결과는 최근 24건, 72건, 168건, 전체 기준으로 다시 볼 수 있습니다.
- 차트 아래에는 겨울/봄/여름/가을 기준의 계절 구간 요약이 표시됩니다.
- 상세 테이블은 timestamp 검색, 현재 보기 CSV 내보내기, 계절 컬럼 및 계절별 그룹 헤더를 지원합니다.
- `VITE_RAINFALL_API_ENDPOINT`가 설정되면 기상청 현재 강수량 카드도 함께 표시합니다.

## Weather Proxy

강수량은 프런트가 기상청 API를 직접 호출하지 않고 별도 `Lambda + API Gateway`를 통해 받도록 구성했습니다.

프런트 env 예시:

```bash
VITE_RAINFALL_API_ENDPOINT=https://your-api-id.execute-api.ap-northeast-2.amazonaws.com/prod/weather/current
VITE_RAINFALL_LOCATION_NAME=HDC Labs 타워
```

Lambda env 예시:

```bash
KMA_SERVICE_KEY=your-service-key
KMA_DEFAULT_NX=60
KMA_DEFAULT_NY=127
LOCATION_NAME=HDC Labs 타워
ALLOW_ORIGIN=https://main.d2nx27l97wl6iy.amplifyapp.com
```

세부 배포 방법은 `backend/weather-proxy/README.md`를 보면 됩니다.

## API Contract Assumption

현재 프런트엔드는 아래 형태를 기대합니다.

```json
{
  "body": {
    "2023.06.01 00:00": {
      "temp": "21.125",
      "vwc": "46.4"
    }
  }
}
```

`body`가 문자열 JSON으로 내려와도 파싱하도록 처리했습니다.

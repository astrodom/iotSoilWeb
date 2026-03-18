# iotSoilWeb

토양 센서 데이터를 AWS API Gateway에서 조회해 시각화하는 정적 대시보드입니다.

## Files

- `index.html`: 화면 구조
- `styles.css`: 대시보드 스타일과 반응형 레이아웃
- `app.js`: 입력 검증, API 호출, 응답 정규화, 요약 카드, 테이블, Chart.js 렌더링
- `index_bak_20230620B.html`: 기존 백업 페이지

## Run

별도 빌드는 필요 없습니다. 브라우저에서 `index.html`을 열면 됩니다.

권장 방식:

1. 간단한 정적 서버 실행
2. 브라우저에서 `http://localhost/.../iotSoilWeb/index.html` 접속

예:

```bash
cd /Users/astro/Workspace/AWS/IoTSensorSoil/iotSoilWeb
python3 -m http.server 8000
```

## Behavior

- 시작일과 종료일은 브라우저의 `date` 입력을 사용합니다.
- API 요청 시 날짜는 `yyyy.mm.dd` 형식으로 변환됩니다.
- 종료일은 inclusive 조회를 위해 내부적으로 하루를 더해 전송합니다.
- 조회 결과는 요약 카드, 추이 차트, 상세 테이블에 동시에 반영됩니다.
- 이전 조회 결과와 차트는 새 조회 시 누적되지 않고 교체됩니다.

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

## Improvements Applied

- 단일 HTML 파일에 섞여 있던 구조, 스타일, 로직 분리
- `onclick` 인라인 이벤트 제거
- 날짜 파싱 안정화
- 요청 중 상태 표시와 버튼 잠금
- API 실패 시 오류 메시지 표시
- 응답 형식 정규화 및 숫자 변환
- 차트 인스턴스 재사용 문제 제거
- 결과 누적 문제 제거
- 반응형 레이아웃과 가독성 개선

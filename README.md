# 제주 공중화장실 안내 (Jeju Public Toilets)

제주 공식 공공데이터로 가까운 공중화장실을 찾는 모바일 웹앱(PWA)입니다.
Manus에서 만든 버전과 같은 화면과 기능을 빌드 도구 없이 동작하도록 다시 만들었습니다.

- 홈: 지금 이용 가능한 가장 가까운 화장실 카드, 카카오맵 바로 길안내, 거리순 목록
- 지도: 한라봉 핀과 묶음(클러스터) 표시, 내 위치. 지도를 못 불러오면 간단 지도로 대체
- 필터: 전체 / 지금 이용 / 24시간 / 휠체어 / 기저귀 교환대 / 비상벨 / 올레길
- 상세: 운영 상태, 도보·차량 예상시간, 접근성·안전 시설, 별점과 한줄 후기(이 기기에만 저장), 카카오·네이버·구글 길찾기, 관리기관 전화
- 4개 언어(한국어 / English / 简体中文 / 日本語), 귤랑이 "장실!" 음성
- 홈 화면에 추가하면 앱처럼 쓸 수 있고, 한 번 연 뒤에는 오프라인에서도 열립니다

원본 데이터에 없는 항목(화장지, 비데, 안심거울, 주차장, 전기차 충전 등)은 지어내지 않고 **정보 없음**으로 표시합니다.

## 폴더 구성

```
index.html              화면 뼈대
css/app.css             디자인
js/app.js               앱 동작
js/i18n.js              4개 언어 문구
js/icons.js             아이콘, 귤랑이 캐릭터
data/toilets.json       화장실 데이터 (스크립트로 생성)
scripts/sync-toilets.mjs  공공데이터 → toilets.json 변환
.github/workflows/sync-toilets.yml  매주 자동 갱신
jangsil.wav             귤랑이 음성
sw.js, manifest.webmanifest, icons/   PWA 설정
```

## 데이터 넣기

### 방법 1: CSV 파일로 (인증키 필요 없음)

1. https://www.data.go.kr/data/15110521/fileData.do 에서 **제주특별자치도 제주시_공중화장실** CSV를 내려받습니다.
   (서귀포시도 넣으려면 서귀포시 공중화장실 CSV도 받습니다.)
2. Node.js 20 이상이 있는 컴퓨터에서 실행합니다.
   ```bash
   node scripts/sync-toilets.mjs 제주시_공중화장실.csv 서귀포시_공중화장실.csv
   ```
3. `data/toilets.json`이 만들어집니다.

### 방법 2: GitHub에서 자동으로 받기 (추천)

인증키는 이미 활용신청이 승인되어 있습니다(제주특별자치도 제주시_공중화장실, odcloud API, 503건).

1. GitHub 저장소 → Settings → Secrets and variables → Actions → **New repository secret**
   이름 `JEJU_OPEN_DATA_SERVICE_KEY`, 값에 일반 인증키를 넣습니다.
2. Actions 탭 → "화장실 데이터 자동 갱신" → **Run workflow**.
   1분 안에 `data/toilets.json`이 만들어져 저장소에 자동 커밋됩니다.
3. 이후 매주 월요일 새벽 3시에 자동으로 다시 받습니다. 포털에 새 기준일 버전이 올라오면 그걸 자동으로 골라 씁니다.

키가 없거나 호출이 실패하면 공식 CSV 다운로드로 대신 받습니다.

인증키는 앱 코드나 저장소 파일에 절대 넣지 마세요. `.env.local`은 `.gitignore`에 들어 있습니다.

## 배포 (GitHub Pages)

1. 이 폴더 전체를 GitHub 저장소에 올립니다.
2. Settings → Pages → Branch를 `main`, 폴더를 `/ (root)`로 저장합니다.
3. 몇 분 뒤 `https://<아이디>.github.io/<저장소>/` 주소로 열립니다.
4. 아이폰 사파리에서 공유 → **홈 화면에 추가**.

내 컴퓨터에서 확인할 때는 파일을 더블클릭하지 말고 간단한 서버로 여세요.
```bash
python3 -m http.server 8000   # → http://localhost:8000
```

## 참고

- 지도: Leaflet + OpenStreetMap (API 키 필요 없음)
- 거리·시간은 직선거리 기반 예상치입니다(도보 75m/분, 차량 430m/분, 우회 18% 보정). 정확한 경로는 길찾기 버튼으로 지도 앱에서 확인하세요.
- 운영시간 판정은 한국시간 기준이며, "09:00~18:00" 같은 형식만 자동 판정합니다. 그 외는 "운영 확인 필요"로 표시합니다.
- 데이터 출처: 공공데이터포털 제주특별자치도 제주시_공중화장실 (공공누리 제1유형)

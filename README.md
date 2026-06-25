# 파주시청 바이브코딩 4회차 Starter Package

3회차에서 만든 개인용 CSV 정리 도구를 4회차 팀 공용 Vercel 서비스로 확장하기 위한 시작 폴더입니다.

## 포함 파일

```text
paju-team-file-collector/
├─ index.html
├─ api/
│  └─ apply-rules.js
├─ sample-data/
│  ├─ team-a-upload.csv
│  ├─ team-b-upload.csv
│  └─ team-c-upload.csv
└─ .vscode/
   ├─ extensions.json
   └─ settings.json
```

## 파일 역할

| 파일 | 역할 |
|---|---|
| `index.html` | 화면, CSV 업로드, 샘플 CSV 불러오기, 결과표, 다운로드 기능 |
| `api/apply-rules.js` | Vercel 서버 함수. CSV 행에 확인필요, 정리메모, 중복후보 규칙 적용 |
| `sample-data/*.csv` | 수업용 샘플 CSV. 실제 개인정보와 내부자료는 넣지 않음 |
| `.vscode/*` | VS Code에서 폴더를 열 때 추천 확장과 기본 설정 안내 |

## 수업 중 수정 위치

1. 화면 문구와 안내문을 바꿀 때: `index.html`
2. 확인필요 조건과 정리메모 규칙을 바꿀 때: `api/apply-rules.js`
3. 팀별 샘플 데이터를 바꿀 때: `sample-data/*.csv`

## 로컬 확인 순서

1. VS Code에서 이 폴더를 엽니다.
2. `index.html`을 엽니다.
3. Live Server 확장으로 `index.html`을 실행합니다.
4. 샘플 CSV 불러오기 버튼을 누릅니다.
5. 규칙 적용 버튼을 누르고 결과표와 다운로드 파일을 확인합니다.

로컬에서 API 연결이 안 되면 브라우저 fallback 규칙으로 결과가 만들어질 수 있습니다. Vercel에 배포한 뒤에는 `/api/apply-rules` 서버 함수 호출과 로그를 함께 확인합니다.

## Vercel 배포 구조

GitHub 저장소에는 이 폴더 안의 파일들이 그대로 올라가야 합니다. 저장소 최상단에 `index.html`과 `api/` 폴더가 보여야 합니다.

```text
GitHub 저장소 최상단
├─ index.html
├─ api/
│  └─ apply-rules.js
└─ sample-data/
   ├─ team-a-upload.csv
   ├─ team-b-upload.csv
   └─ team-c-upload.csv
```

## 안전 기준

- 실제 개인정보, 민원 원문, 내부자료, 계약자료, 예산자료는 넣지 않습니다.
- API 키와 비밀값은 HTML이나 JS 파일에 적지 않습니다.
- Vercel 로그에 실제 개인정보가 남지 않도록 샘플 데이터만 사용합니다.

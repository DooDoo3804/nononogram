# 아키텍처 — 모듈 경계와 공개 API

`main.js` 445줄 단일 파일을 레이어별로 자른 결과다. 5명이 동시에 들어가는 리포라서
**이 문서의 경계와 시그니처가 트랙 간 계약**이다. 남의 소유 파일을 고쳐야 하면 먼저
Angerl에게 묻는다.

## 레이어 규칙

```
ui/      → DOM만 만진다.           THREE import 금지.
render/  → WebGL/canvas만 만진다.  document 조회 금지(캔버스는 주입받는다).
state/   → 게임 규칙만.            DOM·THREE import 금지 → node에서 그대로 테스트된다.
main.js  → 위 셋을 아는 유일한 파일. 배선만. 로직 금지.
```

클릭은 `ui`/`render` → `session`으로 들어가고, 세션이 이벤트를 내보내면 `render`/`ui`가
반응한다. 레이어끼리 서로를 직접 호출하지 않는다 — 그래야 트랙별로 따로 고칠 수 있다.

## 소유권

| 경로 | 소유 트랙 |
|---|---|
| `puzzle.js` `solver.js` `shapes/` `levels.js` | 퍼즐 설계 (Solvera) |
| `vite.config.js` `vitest.config.js` `eslint.config.js` `package.json` `render/` `state/` 골격 `scripts/` | 플랫폼 (Vitra) |
| `index.html` `style.css` `ui/` | UI/UX (Pixa) |
| `state/progress.js` `audio/` 연출 | 게임 디자인 (Rewarde) |
| `tests/` 리포트 | QA (Proba) |

## 공개 API

### `levels.js` — 퍼즐 카탈로그 (퍼즐 트랙의 유일한 교체 지점)
```js
LEVELS            // [{ id, name, puzzles: [{ id, dims, seed }] }]
solutionFor(spec) // -> Uint8Array, 길이 x*y*z, 값 0|1. 결정적(같은 spec → 같은 셀)
cellCount(dims)   // -> number
findLevel(id) / findPuzzle(id)
```
손으로 만든 모양으로 바꿀 때 **`solutionFor`와 퍼즐 스펙만** 고치면 된다. 앱의 나머지는
"해가 어떻게 만들어지는지"를 모른다.

### `state/cells.js` — 셀 상태 (의존성 0)
```js
BLANK = 0, FILLED = 1, MARKED = 2, CELL_STATE_COUNT = 3
```

### `state/session.js` — 한 퍼즐의 한 플레이
DOM·THREE 의존이 없어 node에서 바로 테스트된다.
```js
createSession(spec) -> {
  spec, dims, clues, solution, state,   // state는 살아있는 Uint8Array
  solved,        // getter
  restored,      // 저장된 진행에서 복원됐으면 true
  cycle(i),      // BLANK->FILLED->MARKED->BLANK, 되돌리기 가능. -> 새 값 | null(해결 후 잠김)
  set(i, value), // 직접 지정 (되돌리기 스택에 안 쌓임)
  undo(),        // -> { i, value } | null
  canUndo(),     // -> boolean
  currentRuns(), // -> 지금 보드에서 읽히는 클루 그리드
  on(evt, fn),   // -> 구독 해제 함수
  off(evt, fn),
}
// 이벤트: 'cell' ({ i, value }) | 'solved' ()
```
**게임 디자인 트랙**: 연출·오디오는 `session.on('cell'|'solved')` 구독으로 붙인다 —
`render/`나 `ui/` 수정이 필요 없다.

### `state/progress.js` — 진행 저장 (게임 디자인 트랙 소유)
```js
loadProgress(puzzleId)              // -> { state: number[], solved } | null
saveProgress(puzzleId, cells, solved)
setStorage(storageLike)             // 테스트용 주입
```
localStorage 키 `no-nonogram:<puzzleId>`와 페이로드 모양은 **이미 저장된 브라우저와의
호환 계약**이다. 바꾸려면 편집이 아니라 마이그레이션이 필요하다.

### `render/scene.js` — 단일 WebGL 뷰
```js
createView(canvas) -> {
  scene, camera, renderer, controls,  // 탈출구. 가능하면 메서드를 쓸 것
  resize(), start(), stop(),
  onFrame(cb), frameCamera(dims),
  rayFrom(event),   // 포인터 이벤트 -> Raycaster
  facingAxis(),     // 카메라가 가장 똑바로 보고 있는 축 'x'|'y'|'z'
}
```

### `render/voxels.js` — 클릭 가능한 셀 격자
```js
GAP
createVoxelGrid(dims, { gap }) -> {
  group, setState(i, s), setAll(arr),
  pick(raycaster),  // -> 선형 인덱스 | null
  dispose(), stats(),
}
```
내부 구현(현재 셀당 `Mesh`, 이후 `InstancedMesh`)은 **의도적으로 비공개**다. 호출자는
`puzzle.js`의 `idx()` 선형 인덱스로만 셀을 지목하므로 드로우콜 최적화는 이 파일 안의
변경으로 끝난다.

### `render/gizmo.js` / `render/thumbnail.js` / `render/perf.js`
```js
AXIS_COLORS                          // { x, y, z }
createAxisGizmo(dims, { gap }) -> { group, dispose() }

THUMB_THEME
drawThumb(canvas, dims, cells, theme = THUMB_THEME)   // 2D 아이소 썸네일. theme로 색 주입

createPerfMonitor(renderer, { overlay }) -> { tick(), stats() }
```
`?perf` 쿼리로 라이브 오버레이가 붙고, 예산(16.7ms/프레임, 첫 화면 2s)을 넘기면 빨개진다.

### `ui/*` — 전부 `mount*()` → 핸들러 객체
```js
mountScreens() -> { show(id), current() }
mountMenu({ levels, getProgress, onOpenPuzzle, show }) -> {
  renderLevels(), openLevel(level), reopenCurrentLevel(),
}
mountClues() -> { render(dims, clues, currentRuns), setActiveAxis(axis) }
mountHud({ onUndo }) -> { setStatus(text), setDims(text) }
```

## 무회귀 보증 대상

`scripts/verify-browser.mjs`가 네트워크를 끊은 헤드리스 크롬에서 아래를 검증한다.

- localStorage 키 `no-nonogram:<puzzleId>` 포맷, 리로드 후 진행 복원
- 2D 아이소 썸네일, 퍼즐 카드 진행 배지
- 축 기즈모
- 되돌리기
- 드래그 vs 클릭 5px 임계값 (OrbitControls와 클릭 토글의 공존)
- 바라보는 축 클루 패널 하이라이트
- 서드파티 JS/CSS 요청 0건 (unpkg 제거 증명)
- 첫 화면 2초 예산, 60fps

```sh
npm run build && npx vite preview --port 4173 &
node scripts/verify-browser.mjs http://127.0.0.1:4173
```

## 명령어

```sh
npm run dev      # vite 개발 서버
npm run build    # dist/ 정적 산출물 (base: './' — 아무 경로에나 올라간다)
npm run preview  # 빌드 산출물 서빙
npm test         # vitest. **/*.test.js 전부 — 트랙별 테스트가 어디 있든 게이트에 포함된다
npm run lint     # eslint
npm run check    # lint + test + build
```

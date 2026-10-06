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
| `vite.config.js` `vitest.config.js` `eslint.config.js` `package.json` `render/` `state/` 골격 `scripts/` `bench/` | 플랫폼 (Vitra) |
| `index.html` `style.css` `ui/` | UI/UX (Pixa) |
| `state/progress.js` `audio/` 연출 | 게임 디자인 (Rewarde) |
| `tests/` 리포트 | QA (Proba) |

## 공개 API

### `levels.js` — 퍼즐 카탈로그 (퍼즐 트랙의 유일한 교체 지점)
```js
LEVELS            // [{ id, name, level, box, puzzles: [spec] }]
                  // spec = { id, name, level, dims, cells, tags }
solutionFor(spec) // -> Uint8Array, 길이 x*y*z, 값 0|1. 결정적(같은 spec → 같은 셀)
cellCount(dims)   // -> number
findLevel(id) / findPuzzle(id)
```
DOO-4 이후 `levels.js`는 **아무것도 생성하지 않는다**. 24개 퍼즐 전부 `shapes/index.js`의
손으로 만든 보셀 모양이고, `solutionFor`는 생성기가 아니라 조회다(복사본을 돌려주므로
세션이 카탈로그를 더럽힐 수 없다). 레벨은 모양의 `level` 필드에서, 레벨 안의 순서는
카탈로그 순서(= 난이도 오름차순)에서 그대로 나온다. 퍼즐 id = 모양 id.
앱의 나머지는 "해가 어떻게 만들어지는지"를 모른다.

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
  onFrame(cb),      // 프레임 시작, 렌더 전     -> 구독 해제 함수
  onFrameEnd(cb),   // renderer.render() 직후  -> 구독 해제 함수
  frameCamera(dims),
  rayFrom(event),   // 포인터 이벤트 -> Raycaster
  facingAxis(),     // 카메라가 가장 똑바로 보고 있는 축 'x'|'y'|'z'
}
```
`onFrame`/`onFrameEnd`가 프레임을 **감싼다**. perf가 이 둘 사이를 재서 "우리 코드가
한 프레임에 쓴 CPU 시간"을 뽑는다 — rAF 간격은 vsync에 묶여 16.7ms가 바닥이라
여유를 볼 수 없다.

### `render/voxels.js` — 클릭 가능한 셀 격자 (인스턴싱)
```js
GAP, CELL_SIZE
createVoxelGrid(dims, { gap }) -> {
  group, setState(i, s), setAll(arr),
  pick(raycaster),  // -> 선형 인덱스 | null
  dispose(), stats(),   // stats: { cells, objects, instanced, filled, marked }
}
// 순수 헬퍼 (THREE·DOM 의존 0 — node에서 그대로 테스트됨)
cellCenters(dims, gap)             // -> Float32Array, 셀당 3 float, idx() 순서
outlinePositions(dims, gap, size)  // -> Float32Array, 병합된 외곽선 선분
```
내부 구현은 **의도적으로 비공개**다. 호출자는 `puzzle.js`의 `idx()` 선형 인덱스로만
셀을 지목하므로 드로우콜 최적화는 이 파일 안의 변경으로 끝났다 — DOO-7이 그 증거다.

셀 수와 무관하게 **오브젝트 4개**:

| 오브젝트 | 내용 | 드로우콜 |
|---|---|---|
| `filled` | `InstancedMesh`, FILLED 셀당 인스턴스 1 | 1 |
| `marked` | `InstancedMesh`, MARKED 셀당 인스턴스 1 | 1 |
| `outline` | 모든 셀의 12개 모서리를 **하나의** `LineSegments`로 병합. 불변 | 1 |
| `hit` | 전 셀 `InstancedMesh`, `visible = false`. 레이캐스트 전용 | **0** |

인스턴스는 숨기지 않고 **압축**한다(`count` = 살아있는 인스턴스 수). 그래서
`renderer.info.triangles`가 화면에 없는 셀을 세지 않는다.

`hit`을 숨기는 것이 **load-bearing**이다 — three의 `intersectObject`는 레이어만
필터하고 `visible`은 보지 않으며, `updateMatrixWorld`는 숨은 자식도 갱신한다. 그래서
BLANK 셀도 클릭되면서 드로우콜은 0이다. 이 동작은 `tests/voxels.test.js`가 고정하고
있으니, three 업그레이드가 이걸 깨면 클릭이 조용히 죽는 대신 테스트가 터진다.

### `render/gizmo.js` / `render/thumbnail.js` / `render/perf.js`
```js
AXIS_COLORS                          // { x, y, z }
createAxisGizmo(dims, { gap }) -> { group, dispose() }

THUMB_THEME
drawThumb(canvas, dims, cells, theme = THUMB_THEME)   // 2D 아이소 썸네일. theme로 색 주입

FRAME_BUDGET_MS, FIRST_SCREEN_BUDGET_MS
createPerfMonitor(renderer, { overlay, label }) -> {
  beginFrame(), endFrame(),   // 프레임을 감싼다 (scene.js의 onFrame/onFrameEnd에 건다)
  mark(name),                 // 마일스톤 기록 (navigation start 기준 ms)
  reset(),                    // 측정 창만 비운다. 마일스톤은 유지
  stats(), dispose(),
}
```
`stats()` → `{ fps, frameMs, p95Ms, worstMs, droppedFrames, frames, cpuMs, cpuWorstMs,
drawCalls, triangles, firstFrameMs, marks, over, budgets }`

프레임 숫자가 **두 개**인 이유: `frameMs`는 rAF 간격이라 vsync에 묶여 16.7ms가
바닥이고 — 프레임 드랍만 드러낸다 — `cpuMs`가 여유가 들어있는 숫자다. 데스크톱에서
`cpuMs` 0.15ms면 4배 느린 기기도 예산 안이다.

**예산 초과는 세 곳에서 동시에 드러난다.** 하나만 있으면 아무도 안 본다:

1. `?perf` 라이브 오버레이 — 빨개지고 터진 예산 이름을 찍는다
2. `stats().over` — `['first-screen' | 'cpu-frame' | 'dropped-frames']`. 게이트가 읽는 값
3. 각 예산이 처음 터질 때 `console.warn` 1회 — 오버레이도 CI도 없는 평범한 플레이에서도 보인다

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
- **드로우콜이 보드 크기와 무관하게 상수** (3³ → 6³ 전 레벨을 실제 앱에서 훑는다)

이 게이트는 **퍼즐 카탈로그를 하드코딩하지 않는다.** 예전엔 "카드 12개", "5번 카드는
4×4×4"를 박아놔서 퍼즐 트랙이 `levels.js`를 고칠 때마다 플랫폼 게이트가 빨개졌다. 지금은
카드 수·dims·퍼즐 id를 돌아가는 앱에서 읽는다. 레벨 2~4는 리워드 레이어가 점수로
잠그므로, 게이트가 먼저 `localStorage`에 클리어 진행을 심어서 6³까지 들어간다
(`window.__nonogram.levels()`가 그 용도).

### 렌더 성능 게이트 — `scripts/bench-render.mjs` + `bench/`

`bench/`는 **dims를 파라미터로 받는** 퍼포먼스 하네스다. 카탈로그와 무관하게 아무 크기나
만들 수 있어서, 레벨 4가 들어오기 전에도 6³을 측정할 수 있었다. 산출물에 함께 실린다 —
60fps 예산은 "중간 크기 안드로이드" 기준이고, 그걸 정직하게 읽는 유일한 방법은 **그 폰에서
직접 여는 것**이다:

```
<배포주소>/bench/?suite=3x3x3,4x4x4,5x5x5,6x6x6&sec=4
```

`bench-render.mjs`는 그걸 헤드리스로 돌려서 예산을 못 맞추면 **non-zero로 죽는다**.
프로파일 2개: `desktop`(스로틀 없음)과 `mobile-4x`(412×915 @DPR 2.625 + CPU 4배 감속).
`mobile-4x`는 **대역(proxy)이고 실기가 아니다** — 4배는 Chrome DevTools의 mid-tier
모바일 계수이고 GL 백엔드는 SwiftShader(소프트웨어 래스터)라 실제 폰 GPU보다 느리다.
둘 다 비관적인 방향이라 여기 통과는 **하한선**이다. 실기 측정은 QA 트랙(DOO-8)의 몫.

60fps 판정은 "드랍 0"이 아니라 **p95 ≤ 20ms**로 한다. 4회 반복 측정에서 이 하네스는
5³에서 2/4회 ~20ms 스톨(240프레임 중 2~4프레임)을 냈는데 6³에선 한 번도 안 났다 — 크기와
무관한 GC/SwiftShader 딸꾹질이다. 절반씩 빨개지는 게이트는 아무도 안 보게 되므로, 날카로운
칼은 전 크기·전 실행에서 17.4~18.1ms로 안정적인 p95로 두고 드랍은 2% 느슨한 상한으로
남겼다(숫자는 항상 찍는다).

```sh
npm run build
npm run serve:dist &     # vite preview --port 4173 --host 127.0.0.1
npm run verify           # 무회귀 게이트  (verify-out/ 에 스크린샷)
npm run perf             # 렌더 성능 게이트 (verify-out/bench.json)
```

## 명령어

```sh
npm run dev      # vite 개발 서버
npm run build    # dist/ 정적 산출물 (base: './' — 아무 경로에나 올라간다)
npm run preview  # 빌드 산출물 서빙
npm test         # vitest. **/*.test.js 전부 — 트랙별 테스트가 어디 있든 게이트에 포함된다
npm run lint     # eslint
npm run check    # lint + test + build

npm run serve:dist  # dist/ 를 127.0.0.1:4173 에 서빙 (게이트 2개가 여기에 붙는다)
npm run verify      # 무회귀 게이트 — 헤드리스 크롬, 네트워크 차단
npm run perf        # 렌더 성능 게이트 — 예산 초과면 non-zero
```

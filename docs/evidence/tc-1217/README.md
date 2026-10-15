# TC-1217 slice 1 screenshots

Signed-out local Explorer `/` only, no account data or Connect interaction. Baseline: `main` at `4b6f320`; after: scoped entry/debug styling in this PR. Chromium viewports: 1440×1000 and 390×844 CSS px. Originals and measured detail: `/home/tinycloud/scratch/tc1217/slice1/INDEX.md`.

| Surface | 1440 before → after | 390 before → after |
| --- | --- | --- |
| Entry | [before](before-entry-1440.png) → [after](after-entry-1440.png) | [before](before-entry-390.png) → [after](after-entry-390.png) |
| Debug panel | [before](before-debug-1440.png) → [after](after-debug-1440.png) | [before](before-debug-390.png) → [after](after-debug-390.png) |
| Keyboard focus | Baseline: solid 2 px `#2A56F6` outline | After [1440 focus](after-focus-1440.png): solid 2 px `#2563EB` outline, 2 px offset |

Computed Connect text contrast: baseline **3.05:1** rest and **3.61:1** hover; after **5.17:1** rest and **6.70:1** hover. Target heights: Connect 48→48 px, View debug log 39→44 px, desktop Copy 31→44 px, Clear/Close 44→44 px. Phone after: 390 px scroll width at 390 px viewport. Empty debug copy and disabled actions are unchanged. Palette mapping is proposed, not approved; no deploy.

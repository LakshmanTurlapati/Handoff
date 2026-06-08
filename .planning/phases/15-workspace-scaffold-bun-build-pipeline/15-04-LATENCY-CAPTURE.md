---
phase: 15
plan: 04
type: procedure
requirement: DIST-05
audience: operator
status: awaiting-capture
---

# Phase 15 Plan 04 — Cold-Start Latency Capture Procedure (DIST-05 baseline)

This document is the **operator-runnable procedure** for capturing the DIST-05 cold-start latency baseline for the v1.3 Terminal-only Achilles binaries and the JS-fallback Node bundle. The capture is manual in Phase 15 by design: per `15-RESEARCH.md` §Validation Architecture and `15-CONTEXT.md` item 8, the persistent `~/.achilles/latency/` JSON store is a Phase 18 deliverable (wired alongside the init wizard). For Phase 15 the figures are captured by hand, recorded in the table at the bottom of this file, and then pasted into the Phase 15 SUMMARY.md under a `## Cold-Start Latency Baseline (DIST-05)` heading.

This procedure must NOT be auto-executed. The orchestrator/executor agents have a global rule (see `~/.claude/CLAUDE.md`) against running applications without explicit operator request. Only the operator runs the commands below.

---

## 1. Targets (DIST-05)

| Path                          | Target P50 |
| ----------------------------- | ---------- |
| Native Bun-compiled binary    | < 50 ms    |
| Node 22 JS-fallback bundle    | < 200 ms   |

If a capture exceeds its target, do **not** treat that as a phase failure. Record the figure, note host details, and surface the gap as a tech-debt entry. The CI smoke gate (`.github/workflows/achilles-terminal-ci.yml :: compile-binaries`) is the authoritative GATE-04 check; this latency capture is observational baseline data only.

---

## 2. Install hyperfine

Pick the install method matching the operator host. Hyperfine is available on every common package manager and there is no need to build it from source.

- **macOS (Homebrew):**

  ```
  brew install hyperfine
  ```

- **Linux (cargo, if Rust is installed):**

  ```
  cargo install hyperfine
  ```

  Or via distro package on Debian/Ubuntu 22.04+:

  ```
  sudo apt update && sudo apt install hyperfine
  ```

  Or via the GitHub release `.deb`:

  ```
  curl -L https://github.com/sharkdp/hyperfine/releases/latest/download/hyperfine_<version>_amd64.deb -o /tmp/hyperfine.deb
  sudo dpkg -i /tmp/hyperfine.deb
  ```

- **Windows (winget):**

  ```
  winget install sharkdp.hyperfine
  ```

  Or via Scoop:

  ```
  scoop install hyperfine
  ```

Verify install:

```
hyperfine --version
```

---

## 3. Build the artifacts you want to measure

Before capturing, build the JS-fallback bundle once on any host, and build whichever native binary matches the host you are currently on.

```
# JS-fallback bundle (produces apps/achilles-terminal/dist/main.js)
npm run build --workspace apps/achilles-terminal

# Native binary for the host you are on (produces the matching sibling's bin/ entry)
npm run build:binaries --workspace apps/achilles-terminal
```

After `build:binaries` completes, the relevant sibling directories contain the compiled binaries:

| Host platform-arch | Binary path                                  |
| ------------------ | -------------------------------------------- |
| macOS arm64        | `apps/cli-darwin-arm64/bin/achilles`         |
| macOS x64          | `apps/cli-darwin-x64/bin/achilles`           |
| Linux x64          | `apps/cli-linux-x64/bin/achilles`            |
| Linux arm64        | `apps/cli-linux-arm64/bin/achilles`          |
| Windows x64        | `apps/cli-win32-x64/bin/achilles.exe`        |

You only need to measure the binaries whose hosts you have access to. Record "operator pending — no host access" rows in the table for the platforms you cannot reach; later operators (or CI-hosted hyperfine runs in a future phase) can fill them in.

---

## 4. Capture commands

### 4.1 Native binary (cold-first + warm-steady)

Per `15-RESEARCH.md` Pitfall 6, warm-cache contamination is hard to eliminate completely. Capture both shapes and report both. The `--warmup 0` flag forces the first iteration to be measured (no discarded warm-up runs).

**macOS (cold; requires sudo for the page-cache purge):**

```
sudo purge
hyperfine --warmup 0 --runs 50 './apps/cli-darwin-arm64/bin/achilles --version'
```

**macOS (warm-steady):**

```
hyperfine --warmup 5 --runs 50 './apps/cli-darwin-arm64/bin/achilles --version'
```

**Linux (cold; requires sudo to drop page caches):**

```
sync && echo 3 | sudo tee /proc/sys/vm/drop_caches
hyperfine --warmup 0 --runs 50 './apps/cli-linux-x64/bin/achilles --version'
```

(For `cli-linux-arm64`, substitute the path.)

**Linux (warm-steady):**

```
hyperfine --warmup 5 --runs 50 './apps/cli-linux-x64/bin/achilles --version'
```

**Windows (warm-only — no reliable cold-cache clear):**

PowerShell does not expose a reliable user-space "drop page cache" primitive (the kernel exposes `EmptyStandbyList` only via private APIs / `RAMMap`). Capture warm-steady-state only and document this in the Notes column.

```
hyperfine --warmup 5 --runs 50 ".\apps\cli-win32-x64\bin\achilles.exe --version"
```

### 4.2 JS-fallback bundle (run from any host with Node 22)

```
hyperfine --warmup 0 --runs 50 'node ./apps/achilles-terminal/dist/main.js --version'
```

If your host supports a cold-cache clear (macOS `sudo purge` or Linux `drop_caches`), run that immediately before the hyperfine command above and record the figure as a "cold" row. Otherwise record it as "warm".

---

## 5. Reading hyperfine output

Hyperfine prints summary statistics at the end:

```
Benchmark 1: ./apps/cli-darwin-arm64/bin/achilles --version
  Time (mean +/- sigma):      35.2 ms +/-   2.1 ms    [User: 12.4 ms, System: 9.8 ms]
  Range (min ... max):    32.1 ms ...  44.7 ms    50 runs
```

For DIST-05 we want **P50 (median) and P95 (95th percentile)**. Use the `--export-json` flag to get exact percentiles:

```
hyperfine --warmup 0 --runs 50 --export-json /tmp/achilles-latency.json './apps/cli-darwin-arm64/bin/achilles --version'
```

Then extract P50 and P95 from the JSON `results[0].times` array. A short shell snippet:

```
node -e '
const { times } = JSON.parse(require("fs").readFileSync("/tmp/achilles-latency.json","utf8")).results[0];
const sorted = times.slice().sort((a,b) => a-b);
const pct = (p) => sorted[Math.floor(p/100 * (sorted.length - 1))];
console.log("P50:", (pct(50)*1000).toFixed(1), "ms");
console.log("P95:", (pct(95)*1000).toFixed(1), "ms");
'
```

The `times` field is in **seconds**; the snippet converts to ms.

---

## 6. Operator capture table (fill in then paste into Phase 15 SUMMARY.md)

Fill in the rows you have access to. Leave the rest as "operator pending". The minimum-viable capture is **the host you are currently on plus the JS-fallback path** — that satisfies DIST-05 baseline for at least one platform.

| Platform        | Path (native | JS-fallback) | P50 (ms) | P95 (ms) | Host details (CPU, RAM, OS version)                | Cache state (cold | warm) |
| --------------- | --------------------------- | -------- | -------- | -------------------------------------------------- | --------------------------- |
| darwin-arm64    | native                      |          |          |                                                    |                             |
| darwin-x64      | native                      |          |          |                                                    |                             |
| linux-x64       | native                      |          |          |                                                    |                             |
| linux-arm64     | native                      |          |          |                                                    |                             |
| win32-x64       | native                      |          |          |                                                    |                             |
| any (Node 22)   | JS-fallback                 |          |          |                                                    |                             |

When pasting into Phase 15 SUMMARY.md, place the filled table under a heading `## Cold-Start Latency Baseline (DIST-05)` and include a one-line note for any platform marked "operator pending — no host access at SUMMARY-write time". The Phase 15 SUMMARY.md is created by `/gsd:verify-work` after all plans complete; this file survives separately for traceability and re-capture in future phases.

---

## 7. Resume signal

After capturing the figures and filling the table above, the operator types `approved` to the orchestrator (or describes the partial-capture gap, e.g. "Only had access to macOS arm64; figures captured for that host only — Linux/Windows pending operator with access"). The orchestrator then closes the `checkpoint:human-verify` gate for Plan 15-04.

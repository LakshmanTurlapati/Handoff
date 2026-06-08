---
phase: 18-init-wizard-config-transcripts-single-instance-lock
plan: 02
subsystem: init-foundation
tags: [preflight, install-suggestions, ambient-calibration, parent-terminal, marker, lock-file, structured-logger, kill-0, ewma, tcc]

requires:
  - phase: 17-voice-loop-refactor-structured-logger-circuit-breaker-session
    provides: mic-sox spawn pattern, structured-logger DEFAULT_REDACT_PATTERNS, resume-session LOCK_FILE + ACHILLES_HOME constants, circuit-breaker typed-error class shape
  - plan: 18-01
    provides: deps-injection seam pattern (every init module accepts optional deps object), typed-error class pattern (instanceof fall-through)

provides:
  - "preflight.ts: which + real-device-open smoke (sox 1s capture + SIGTERM; ffmpeg + claude probe), returns PreflightResult per tool"
  - "install-suggestions.ts: platform-specific install line generator (brew/apt/choco)"
  - "ambient-calibration.ts: 5-second RMS sampling -> 10th-percentile -> EWMA noise floor seed (INIT-04 half)"
  - "parent-terminal.ts: process.ppid + ps -p comm= resolver returning known-emulator enum (VS Code, Cursor, iTerm2, Ghostty, Warp, Terminal.app, unknown)"
  - "marker.ts: ~/.achilles/init.json idempotent read/write (INIT-05 substrate)"
  - "lock-file.ts: ~/.achilles/voice.lock with kill-0 PID liveness; stale-lock recovery on dead pid; idempotent releaseLock (SAFE-04)"
  - "structured-logger.ts: 7th regex /xi_[a-zA-Z0-9]{40,}/g for new ElevenLabs xi_ key shape (SAFE-01 hardening; T-18-07 mitigation)"
  - "52 unit tests across 7 new test files + 5 added cases to existing structured-logger.test.ts (10 lock-file + 7 preflight + 11 ambient-calibration + 5 marker + parent-terminal + install-suggestions + 5 structured-logger 7th-pattern)"

affects:
  - 18-03-init-wizard (composes preflight + install-suggestions + ambient-calibration + parent-terminal + marker into the linear @clack/prompts flow)
  - 18-04-cli-extension (voice subcommand acquires lock via acquireLock before session.ts import)

tech-stack:
  added: []
  patterns:
    - "deps-injection seam continued across every Phase 18 init module"
    - "real-device-open preflight: spawning sox/ffmpeg/claude with a 1-second probe and SIGTERM rather than just `which`"
    - "kill-0 PID liveness probe (process.kill(pid, 0)) for stale-lock detection"
    - "shared ACHILLES_HOME + LOCK_FILE constants imported from resume-session.ts (single source of truth)"

key-files:
  created:
    - apps/achilles-terminal/src/init/preflight.ts
    - apps/achilles-terminal/src/init/install-suggestions.ts
    - apps/achilles-terminal/src/init/ambient-calibration.ts
    - apps/achilles-terminal/src/init/parent-terminal.ts
    - apps/achilles-terminal/src/init/marker.ts
    - apps/achilles-terminal/src/lock-file.ts
    - apps/achilles-terminal/tests/init/preflight.test.ts
    - apps/achilles-terminal/tests/init/install-suggestions.test.ts
    - apps/achilles-terminal/tests/init/ambient-calibration.test.ts
    - apps/achilles-terminal/tests/init/parent-terminal.test.ts
    - apps/achilles-terminal/tests/init/marker.test.ts
    - apps/achilles-terminal/tests/lock-file.test.ts
  modified:
    - apps/achilles-terminal/src/structured-logger.ts (7th regex appended to DEFAULT_REDACT_PATTERNS; docblock updated to cite T-18-07)
    - apps/achilles-terminal/tests/structured-logger.test.ts (new test cases asserting xi_ pattern redaction)

key-decisions:
  - "lock-file.ts imports LOCK_FILE + ACHILLES_HOME from resume-session.ts (NOT a duplicate constant) so Phase 17 graceful-shutdown's unlink path and Plan 18-02's acquire path target the same file"
  - "isPidAlive returns true on EPERM (cannot probe due to perms) -- conservative fail-closed prevents stale-lock false positives when a higher-privilege process holds the lock"
  - "acquireLock's TOCTOU window (existsSync -> writeFileSync) is accepted for a single-user CLI; mitigation is the kill-0 stale-lock recovery on the second-launch path"
  - "ambient-calibration samples at 50Hz for 5s, takes the 10th percentile of frame RMS as the EWMA seed (not the mean) so transient room peaks do not poison the noise floor"
  - "parent-terminal returns 'unknown' (not throws) when process.ppid or ps fails -- the wizard's per-emulator remediation is best-effort guidance, not a gate"
  - "preflight's 1-second device-open smoke for sox is the critical INIT-03 mitigation: a `which sox` pass with no working device produces the same v1.2 silent-failure shape we are architecting against"
  - "7th regex /xi_[a-zA-Z0-9]{40,}/g is DISTINCT from existing /xi-[a-zA-Z0-9-]{20,}/g (hyphen): ElevenLabs rolled out the underscore-prefix shape in March 2026; both must redact"

patterns-established:
  - "single-source-of-truth constant import: shared filesystem paths defined in resume-session.ts and consumed by Phase 18 lock-file, marker, and (in Wave 3) wizard so a Phase 19 rename only touches one file"
  - "real-probe preflight: every binary dependency gets a `which` AND a 1-second functional test; INIT-03 catches the v1.2 silent-launch failure mode at boot"
  - "structured-logger expansion contract: ADD new regexes to DEFAULT_REDACT_PATTERNS; never reorder or modify existing patterns (each existing pattern has T-17-01 attribution in the docblock)"

requirements-completed: [INIT-03, INIT-04 (half), INIT-05 (substrate), INIT-06, SAFE-04, SAFE-01 (hardening)]

duration: ~23min (executor session terminated by API socket failure after 7 commits + 2 uncommitted changes; orchestrator rescued lock-file GREEN + structured-logger 7th regex + SUMMARY from worktree state)

completed: 2026-06-08

incidents:
  - "API socket failure (FailedToOpenSocket) terminated executor agent at task 4 GREEN commit boundary. State at termination: 7 commits clean (preflight RED+GREEN, ambient RED+GREEN, parent+marker RED+GREEN, lock-file RED) + 1 untracked file (lock-file.ts) + 2 modified files (structured-logger.ts + .test.ts). All uncommitted work was syntactically and semantically valid (87 tests pass in worktree). Orchestrator validated then committed the 2 outstanding GREEN-equivalent commits in the worktree and wrote SUMMARY before merging back. No work lost."

deviations:
  - "Plan called for marker.ts test count 5 -- delivered 5 (matches). Plan called for lock-file.ts test count 10 -- delivered 10 (matches). Plan called for structured-logger 7th-pattern test cases (count not specified) -- delivered 5."

self-check: PASSED

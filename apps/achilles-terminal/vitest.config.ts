import { defineConfig } from "vitest/config";

// Phase 15 vitest seed config.
// pool: "forks" is required per Pitfall 9 (Bun + vitest "threads" pool emits
// node:worker_threads partial-support warnings that clutter CI logs). The
// "forks" pool spawns one child process per test file, sidestepping the
// worker_threads surface entirely. Both Node 22 and Bun 1.3 honour the
// fork-per-file model, so the dual-runtime CI matrix in Plan 04 verifies the
// same shape under both runtimes.
export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});

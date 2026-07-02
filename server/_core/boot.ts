// Boot self-check: degrade-not-crash for non-core initialization.
// Principle (2026-07-02 incident review): a non-core module failing to initialize (cron 注册、
// scheduler 恢复、可选集成) must DEGRADE (that feature is off, an ERROR is logged, and the failure
// is visible on /api/health) — it must NOT take the whole service down.
// NOTE the honest scope: initGuard protects EXECUTION of init code. A syntax/import-time error in a
// module still crashes at import — that class is caught by `pnpm run check` + the post-deploy smoke.

export interface BootError {
  module: string;
  message: string;
  at: string; // ISO timestamp
}

const bootErrors: BootError[] = [];
const BOOT_TS = Date.now();

export function getBootErrors(): BootError[] {
  return bootErrors;
}

export function getBootInfo() {
  return { startedAt: new Date(BOOT_TS).toISOString(), uptimeSec: Math.round((Date.now() - BOOT_TS) / 1000) };
}

function record(module: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  bootErrors.push({ module, message: message.slice(0, 500), at: new Date().toISOString() });
  // eslint-disable-next-line no-console
  console.error(`[BOOT-GUARD] [${module}] init failed (degraded, service continues): ${message}`);
}

// Wrap module-top-level init (sync or async). Catches sync throws AND async rejections.
// Never throws, never rejects — the caller's module keeps loading.
export function initGuard(module: string, fn: () => void | Promise<void>): void {
  try {
    const r = fn();
    if (r && typeof (r as Promise<void>).catch === "function") {
      (r as Promise<void>).catch((e) => record(module, e));
    }
  } catch (e) {
    record(module, e);
  }
}

// Last-resort process guards. Deliberate tradeoff per the degrade-not-crash principle:
// log + record instead of exiting, so one bad timer/promise can't kill the whole service.
let installed = false;
export function installProcessGuards(): void {
  if (installed) return;
  installed = true;
  process.on("unhandledRejection", (reason) => {
    record("process:unhandledRejection", reason);
  });
  process.on("uncaughtException", (err) => {
    // Keeping the process alive after an uncaught SYNC exception is risky in general, but this
    // service prefers a degraded survivor over an outage; state-corrupting crashes would surface
    // via /api/health bootErrors and ERROR logs.
    record("process:uncaughtException", err);
  });
}

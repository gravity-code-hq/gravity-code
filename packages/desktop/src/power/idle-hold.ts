export interface IdleHoldBlocker {
  start(): number;
  stop(id: number): void;
  isStarted(id: number): boolean;
}

// Keeps the machine from idle-sleeping while a local agent is working. This is the
// unprivileged tier under Caffeine mode: it never survives lid close and needs no
// authorization, so it runs automatically. The OS drops the assertion with the
// process, so there is nothing to recover after a crash.
export function createIdleHold(blocker: IdleHoldBlocker) {
  let id: number | null = null;

  function active() {
    return id !== null && blocker.isStarted(id);
  }

  function set(hold: boolean) {
    if (hold) {
      if (active()) return;
      id = blocker.start();
      return;
    }
    if (id === null) return;
    const previous = id;
    id = null;
    if (blocker.isStarted(previous)) blocker.stop(previous);
  }

  return { active, set, close: () => set(false) };
}

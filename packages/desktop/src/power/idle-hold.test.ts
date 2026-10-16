import { expect, test } from "vitest";
import { createIdleHold } from "./idle-hold.js";

function blocker() {
  const started = new Set<number>();
  let next = 1;
  const calls: string[] = [];
  return {
    calls,
    started,
    start() {
      const id = next++;
      started.add(id);
      calls.push(`start:${id}`);
      return id;
    },
    stop(id: number) {
      started.delete(id);
      calls.push(`stop:${id}`);
    },
    isStarted: (id: number) => started.has(id),
  };
}

test("holds idle sleep once while agents run and releases when none remain", () => {
  const b = blocker();
  const hold = createIdleHold(b);
  hold.set(true);
  hold.set(true);
  expect(hold.active()).toBe(true);
  hold.set(false);
  hold.set(false);
  expect(hold.active()).toBe(false);
  expect(b.calls).toEqual(["start:1", "stop:1"]);
});

test("re-arms when the OS dropped the assertion behind our back", () => {
  const b = blocker();
  const hold = createIdleHold(b);
  hold.set(true);
  b.started.clear();
  expect(hold.active()).toBe(false);
  hold.set(true);
  expect(hold.active()).toBe(true);
  hold.set(false);
  expect(b.calls).toEqual(["start:1", "start:2", "stop:2"]);
});

test("close releases without stopping an assertion the OS already dropped", () => {
  const b = blocker();
  const hold = createIdleHold(b);
  hold.set(true);
  b.started.clear();
  hold.close();
  expect(b.calls).toEqual(["start:1"]);
  expect(hold.active()).toBe(false);
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { createCommandDictation, COMMAND_DOUBLE_PRESS_MS } from "./command-dictation";

const command = {
  code: "MetaLeft",
  repeat: false,
  altKey: false,
  ctrlKey: false,
  shiftKey: false,
  isComposing: false,
};

function setup(start = async () => {}) {
  vi.useFakeTimers();
  let recording = false;
  const actions = {
    canToggle: vi.fn(() => true),
    canStart: vi.fn(() => true),
    isRecording: () => recording,
    start: vi.fn(async () => {
      await start();
      recording = true;
    }),
    insert: vi.fn(async () => {
      recording = false;
    }),
    cancel: vi.fn(async () => {
      recording = false;
    }),
    onError: vi.fn(),
  };
  const shortcut = createCommandDictation(actions);
  function tap(code = "MetaLeft") {
    shortcut.keyDown({ ...command, code });
    shortcut.keyUp({ ...command, code });
  }
  return { actions, shortcut, tap };
}

afterEach(() => vi.useRealTimers());

describe("double-press Command dictation", () => {
  it.each(["MetaLeft", "MetaRight"])("starts and inserts with two presses of %s", async (code) => {
    const { actions, tap } = setup();
    tap(code);
    await vi.advanceTimersByTimeAsync(100);
    expect(actions.start).toHaveBeenCalledTimes(0);
    tap(code);
    await vi.runAllTimersAsync();
    expect(actions.start).toHaveBeenCalledTimes(1);
    expect(actions.insert).toHaveBeenCalledTimes(0);
    tap(code);
    tap(code);
    await vi.runAllTimersAsync();
    expect(actions.insert).toHaveBeenCalledTimes(1);
    expect(actions.cancel).toHaveBeenCalledTimes(0);
  });

  it.each(["KeyC", "KeyV", "Tab", "ShiftLeft"])(
    "ignores Command combinations with %s",
    async (code) => {
      const { actions, shortcut, tap } = setup();
      tap();
      shortcut.keyDown(command);
      shortcut.keyDown({ ...command, code });
      shortcut.keyUp(command);
      tap();
      await vi.runAllTimersAsync();
      expect(actions.start).toHaveBeenCalledTimes(0);
    },
  );

  it("does not interpret holding Command or widely spaced presses as a double press", async () => {
    const { actions, shortcut, tap } = setup();
    tap();
    await vi.advanceTimersByTimeAsync(COMMAND_DOUBLE_PRESS_MS + 1);
    tap();
    shortcut.keyDown(command);
    shortcut.keyDown({ ...command, repeat: true });
    await vi.advanceTimersByTimeAsync(COMMAND_DOUBLE_PRESS_MS + 1);
    shortcut.keyUp(command);
    await vi.runAllTimersAsync();
    expect(actions.start).toHaveBeenCalledTimes(0);
  });

  it("ignores modified keys, composition and both Command keys pressed together", async () => {
    const { actions, shortcut, tap } = setup();
    tap();
    shortcut.keyDown({ ...command, shiftKey: true });
    shortcut.keyUp(command);
    shortcut.keyDown({ ...command, isComposing: true });
    shortcut.keyUp(command);
    shortcut.keyDown(command);
    shortcut.keyDown({ ...command, code: "MetaRight" });
    shortcut.keyUp(command);
    shortcut.keyUp({ ...command, code: "MetaRight" });
    tap();
    await vi.runAllTimersAsync();
    expect(actions.start).toHaveBeenCalledTimes(0);
  });

  it("waits for microphone startup before processing another double press", async () => {
    let ready!: () => void;
    const { actions, tap } = setup(
      () =>
        new Promise<void>((resolve) => {
          ready = resolve;
        }),
    );
    tap();
    tap();
    await vi.runAllTimersAsync();
    tap();
    tap();
    expect(actions.insert).toHaveBeenCalledTimes(0);
    ready();
    await vi.runAllTimersAsync();
    expect(actions.start).toHaveBeenCalledTimes(1);
    expect(actions.insert).toHaveBeenCalledTimes(1);
  });

  it("does not cancel recording when using another Command shortcut", async () => {
    const { actions, shortcut, tap } = setup();
    tap();
    tap();
    await vi.runAllTimersAsync();
    shortcut.keyDown(command);
    shortcut.keyDown({ ...command, code: "KeyC" });
    shortcut.keyUp(command);
    await vi.runAllTimersAsync();
    expect(actions.cancel).toHaveBeenCalledTimes(0);
    expect(actions.insert).toHaveBeenCalledTimes(0);
  });

  it("stops and preserves text when the window loses focus", async () => {
    const { actions, shortcut, tap } = setup();
    tap();
    tap();
    await vi.runAllTimersAsync();
    shortcut.blur();
    await vi.runAllTimersAsync();
    expect(actions.insert).toHaveBeenCalledTimes(1);
  });

  it("clears an incomplete gesture on pointer input or blur", async () => {
    const { actions, shortcut, tap } = setup();
    tap();
    shortcut.pointerDown();
    tap();
    shortcut.blur();
    tap();
    await vi.runAllTimersAsync();
    expect(actions.start).toHaveBeenCalledTimes(0);
  });

  it("does not start if dictation is unavailable", async () => {
    const { actions, tap } = setup();
    actions.canStart.mockReturnValue(false);
    tap();
    tap();
    await vi.runAllTimersAsync();
    expect(actions.start).toHaveBeenCalledTimes(0);
  });

  it("cancels pending startup when its composer is removed", async () => {
    let ready!: () => void;
    const { actions, shortcut, tap } = setup(
      () =>
        new Promise<void>((resolve) => {
          ready = resolve;
        }),
    );
    tap();
    tap();
    await vi.runAllTimersAsync();
    shortcut.dispose();
    ready();
    await vi.runAllTimersAsync();
    expect(actions.cancel).toHaveBeenCalledTimes(1);
    tap();
    tap();
    await vi.runAllTimersAsync();
    expect(actions.start).toHaveBeenCalledTimes(1);
  });

  it("reports startup failure and permits a later attempt", async () => {
    const failure = new Error("Microphone unavailable");
    const { actions, tap } = setup();
    actions.start.mockRejectedValueOnce(failure);
    tap();
    tap();
    await vi.runAllTimersAsync();
    expect(actions.onError).toHaveBeenCalledWith(failure);
    tap();
    tap();
    await vi.runAllTimersAsync();
    expect(actions.start).toHaveBeenCalledTimes(2);
  });
});

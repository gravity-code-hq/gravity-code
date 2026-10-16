export const COMMAND_DOUBLE_PRESS_MS = 400;

interface CommandDictationActions {
  canToggle(): boolean;
  canStart(): boolean;
  isRecording(): boolean;
  start(): Promise<void>;
  insert(): Promise<void>;
  cancel(): Promise<void>;
  onError(error: unknown): void;
}

type CommandKeyEvent = Pick<
  KeyboardEvent,
  "code" | "repeat" | "altKey" | "ctrlKey" | "shiftKey" | "isComposing"
>;

interface CommandPress {
  code: string;
  time: number;
}

export function createCommandDictation(actions: CommandDictationActions) {
  let press: CommandPress | null = null;
  let lastTap: CommandPress | null = null;
  const commandsDown = new Set<string>();
  let disposed = false;
  let ownsRecording = false;
  let transition = Promise.resolve();

  function resetGesture() {
    press = null;
    lastTap = null;
  }

  function enqueue(action: () => Promise<void>) {
    transition = transition.then(action).catch(actions.onError);
  }

  async function toggle() {
    if (disposed || !actions.canToggle()) return;
    if (actions.isRecording()) {
      ownsRecording = false;
      await actions.insert();
      return;
    }
    if (!actions.canStart()) return;
    ownsRecording = true;
    // Serialize toggles so a second double press during microphone setup stops
    // the recording after startup, instead of being ignored before it is ready.
    await actions.start();
    if (disposed) {
      ownsRecording = false;
      await actions.cancel();
    }
  }

  return {
    keyDown(event: CommandKeyEvent) {
      if (disposed || event.repeat) return;
      const isCommand = event.code === "MetaLeft" || event.code === "MetaRight";
      if (isCommand) commandsDown.add(event.code);
      const plainCommand =
        isCommand &&
        commandsDown.size === 1 &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.isComposing;
      if (!plainCommand) {
        resetGesture();
        return;
      }
      press = { code: event.code, time: Date.now() };
    },
    keyUp(event: Pick<CommandKeyEvent, "code">) {
      commandsDown.delete(event.code);
      if (disposed || press?.code !== event.code) return;
      const now = Date.now();
      const wasTap = now - press.time <= COMMAND_DOUBLE_PRESS_MS;
      press = null;
      if (!wasTap) {
        lastTap = null;
        return;
      }
      const isDoublePress =
        lastTap?.code === event.code && now - lastTap.time <= COMMAND_DOUBLE_PRESS_MS;
      if (isDoublePress) {
        lastTap = null;
        enqueue(toggle);
      } else {
        lastTap = { code: event.code, time: now };
      }
    },
    pointerDown: resetGesture,
    blur() {
      resetGesture();
      commandsDown.clear();
      enqueue(async () => {
        if (!ownsRecording || disposed) return;
        ownsRecording = false;
        if (actions.isRecording()) await actions.insert();
      });
    },
    dispose() {
      resetGesture();
      commandsDown.clear();
      disposed = true;
      enqueue(async () => {
        if (!ownsRecording) return;
        ownsRecording = false;
        if (actions.isRecording()) await actions.cancel();
      });
    },
  };
}

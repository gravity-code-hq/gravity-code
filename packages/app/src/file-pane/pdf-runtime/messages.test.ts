import { describe, expect, it } from "vitest";
import { parsePdfRuntimeCommand, parsePdfRuntimeMessage } from "./messages";

describe("parsePdfRuntimeCommand", () => {
  it("accepts load and zoom commands", () => {
    const data = new Uint8Array([1, 2, 3]);
    expect(parsePdfRuntimeCommand({ type: "load", revision: 2, data })).toEqual({
      type: "load",
      revision: 2,
      data,
    });
    expect(parsePdfRuntimeCommand({ type: "zoom", action: "fit" })).toEqual({
      type: "zoom",
      action: "fit",
    });
  });

  it("rejects malformed commands", () => {
    expect(parsePdfRuntimeCommand({ type: "load", revision: 1, data: [1, 2] })).toBeNull();
    expect(parsePdfRuntimeCommand({ type: "zoom", action: "spin" })).toBeNull();
    expect(parsePdfRuntimeCommand("load")).toBeNull();
  });
});

describe("parsePdfRuntimeMessage", () => {
  it("accepts view state from the runtime", () => {
    expect(
      parsePdfRuntimeMessage({
        type: "state",
        revision: 1,
        page: 2,
        pageCount: 4,
        scale: 1.25,
        fit: true,
      }),
    ).toEqual({ type: "state", revision: 1, page: 2, pageCount: 4, scale: 1.25, fit: true });
  });

  it("rejects state with missing or non-finite fields", () => {
    expect(
      parsePdfRuntimeMessage({ type: "state", revision: 1, page: 1, pageCount: 1, scale: NaN }),
    ).toBeNull();
    expect(parsePdfRuntimeMessage({ type: "openLink", url: 42 })).toBeNull();
  });
});

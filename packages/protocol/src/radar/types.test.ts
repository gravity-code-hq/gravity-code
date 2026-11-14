import { describe, expect, test } from "vitest";
import { normalizeRadarChannel } from "./types.js";

describe("normalizeRadarChannel", () => {
  test("accepts a name with or without the hash", () => {
    expect(normalizeRadarChannel(" #alerts ")).toBe("alerts");
    expect(normalizeRadarChannel("eng-alerts")).toBe("eng-alerts");
  });

  test("keeps a channel id as typed", () => {
    expect(normalizeRadarChannel("C0ALERTS123")).toBe("C0ALERTS123");
  });

  test("pulls the channel id out of a pasted Slack link", () => {
    expect(
      normalizeRadarChannel("https://acme.slack.com/archives/C0ALERTS123/p1794564010000100"),
    ).toBe("C0ALERTS123");
  });

  test("returns an empty string when nothing is left", () => {
    expect(normalizeRadarChannel(" # ")).toBe("");
  });
});

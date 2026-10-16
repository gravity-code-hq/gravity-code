import { describe, expect, it } from "vitest";
import {
  COMPOSER_TOOLBAR_GEOMETRY,
  resolveComposerControlDensity,
  resolveComposerControlPresentation,
  resolveComposerToolbarGlyphSize,
} from "./layout";

describe("composer control layout", () => {
  it("removes labels in priority order as the toolbar narrows", () => {
    expect(resolveComposerControlPresentation("full")).toEqual({
      showCarets: true,
      showThinkingLabel: true,
      showPlanLabel: true,
    });
    expect(resolveComposerControlPresentation("condensed")).toEqual({
      showCarets: false,
      showThinkingLabel: false,
      showPlanLabel: true,
    });
    expect(resolveComposerControlPresentation("tight")).toEqual({
      showCarets: false,
      showThinkingLabel: false,
      showPlanLabel: false,
    });
  });

  it("uses local available width and hysteresis to avoid density churn", () => {
    const controls = {
      hasModel: true,
      hasThinking: true,
      hasPlan: true,
      hasSettings: true,
      fontScale: 1,
    };

    expect(
      resolveComposerControlDensity({
        availableWidth: 360,
        currentDensity: "full",
        controls,
      }),
    ).toBe("full");
    expect(
      resolveComposerControlDensity({
        availableWidth: 300,
        currentDensity: "full",
        controls,
      }),
    ).toBe("condensed");
    expect(
      resolveComposerControlDensity({
        availableWidth: 225,
        currentDensity: "condensed",
        controls,
      }),
    ).toBe("condensed");
    expect(
      resolveComposerControlDensity({
        availableWidth: 220,
        currentDensity: "condensed",
        controls,
      }),
    ).toBe("tight");
    expect(
      resolveComposerControlDensity({
        availableWidth: 240,
        currentDensity: "tight",
        controls,
      }),
    ).toBe("tight");
    expect(
      resolveComposerControlDensity({
        availableWidth: 250,
        currentDensity: "tight",
        controls,
      }),
    ).toBe("condensed");
  });

  it("budgets one settings trigger regardless of the provider's secondary controls", () => {
    const controls = {
      hasModel: true,
      hasThinking: true,
      hasPlan: true,
      hasSettings: true,
      fontScale: 1,
    };
    expect(
      resolveComposerControlDensity({ availableWidth: 350, currentDensity: "condensed", controls }),
    ).toBe("full");
    expect(
      resolveComposerControlDensity({
        availableWidth: 350,
        currentDensity: "condensed",
        controls: { ...controls, fontScale: 1.5 },
      }),
    ).toBe("condensed");
  });

  it("gives every toolbar control one shell and one platform glyph envelope", () => {
    expect(COMPOSER_TOOLBAR_GEOMETRY).toEqual({
      controlSize: 28,
      controlGap: 4,
      iconLabelGap: 4,
      labelPadding: 8,
      caretSize: 14,
    });
    expect(resolveComposerToolbarGlyphSize("web")).toBe(16);
    expect(resolveComposerToolbarGlyphSize("native")).toBe(20);
  });
});

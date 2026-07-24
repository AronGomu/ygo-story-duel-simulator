import { describe, expect, it } from "vitest";
import { PROTOTYPE_COLORS } from "../../../src/prototype/prototype-colors.ts";

describe("prototype contrast tokens", () => {
  it.each([
    ["text", "background", 4.5],
    ["muted", "background", 4.5],
    ["text", "panel", 4.5],
    ["accent", "background", 4.5],
    ["buttonText", "accent", 4.5],
  ] as const)(
    "%s on %s meets normal text contrast",
    (foreground, background, required) => {
      expect(
        contrast(PROTOTYPE_COLORS[foreground], PROTOTYPE_COLORS[background]),
      ).toBeGreaterThanOrEqual(required);
    },
  );

  it.each([
    ["focus", "background", 3],
    ["stateBorder", "panel", 3],
    ["error", "background", 3],
  ] as const)(
    "%s against %s meets non-text contrast",
    (foreground, background, required) => {
      expect(
        contrast(PROTOTYPE_COLORS[foreground], PROTOTYPE_COLORS[background]),
      ).toBeGreaterThanOrEqual(required);
    },
  );
});

function contrast(left: string, right: string): number {
  const luminance = (hex: string): number => {
    const channels = hex
      .slice(1)
      .match(/.{2}/g)!
      .map((value) => Number.parseInt(value, 16) / 255)
      .map((value) =>
        value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
      );
    return (
      0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
    );
  };
  const [bright, dark] = [luminance(left), luminance(right)].sort(
    (a, b) => b - a,
  );
  return (bright! + 0.05) / (dark! + 0.05);
}

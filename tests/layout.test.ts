import { describe, expect, it } from "vitest";
import { bottomInset } from "../src/layout";

const view = { left: 1000, right: 1340, top: 40, bottom: 900 };

describe("bottomInset", () => {
  it("is the height of the status bar part that covers the bottom of the view", () => {
    expect(bottomInset(view, { left: 1100, right: 1340, top: 872, bottom: 900 })).toBe(28);
  });

  it("is 0 without a status bar or when it is hidden", () => {
    expect(bottomInset(view, null)).toBe(0);
    expect(bottomInset(view, { left: 0, right: 0, top: 0, bottom: 0 })).toBe(0);
  });

  it("is 0 when the status bar is beside or below the view", () => {
    expect(bottomInset(view, { left: 600, right: 990, top: 872, bottom: 900 })).toBe(0);
    expect(bottomInset({ ...view, bottom: 860 }, { left: 1100, right: 1340, top: 872, bottom: 900 })).toBe(0);
  });

  it("rounds up partial pixels", () => {
    expect(bottomInset(view, { left: 1100, right: 1340, top: 871.4, bottom: 900 })).toBe(29);
  });
});

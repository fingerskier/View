import { describe, expect, it } from "vitest";
import { mergeLayout } from "./sheet";

const range = (r0: number, c0: number, r1: number, c1: number) => ({ s: { r: r0, c: c0 }, e: { r: r1, c: c1 } });

describe("mergeLayout", () => {
  it("spans the top-left cell and covers the rest", () => {
    const { spans, covered } = mergeLayout([range(1, 1, 2, 3)], range(0, 0, 99, 99));
    expect(spans.get("1:1")).toEqual({ rows: 2, cols: 3 });
    expect([...covered].sort()).toEqual(["1:2", "1:3", "2:1", "2:2", "2:3"]);
  });

  it("clips a huge merge to the displayed window", () => {
    const { spans, covered } = mergeLayout([range(0, 0, 999_999, 15_000)], range(0, 0, 9, 25));
    expect(spans.get("0:0")).toEqual({ rows: 10, cols: 26 });
    expect(covered.size).toBe(10 * 26 - 1);
  });

  it("clips merges that start above or left of the window", () => {
    const { spans, covered } = mergeLayout([range(0, 0, 20_000, 0), range(0, 0, 19_999, 0)], range(20_000, 0, 20_009, 9));
    expect(spans.get("20000:0")).toEqual({ rows: 1, cols: 1 });
    expect(spans.size).toBe(1);
    expect(covered.size).toBe(0);
  });

  it("skips merges outside the window", () => {
    const { spans, covered } = mergeLayout([range(20_000, 0, 30_000, 5), range(0, 300, 4, 400)], range(0, 0, 4999, 199));
    expect(spans.size).toBe(0);
    expect(covered.size).toBe(0);
  });
});

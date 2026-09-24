import { describe, expect, test } from "bun:test";

import { parseRange } from "./range";

describe("parseRange (Safari/iPhone pide audio y video por partes)", () => {
  test("rangos válidos", () => {
    expect(parseRange("bytes=0-1", 1000)).toEqual([0, 1]);
    expect(parseRange("bytes=100-", 1000)).toEqual([100, 999]);
    expect(parseRange("bytes=-200", 1000)).toEqual([800, 999]);
    expect(parseRange("bytes=900-5000", 1000)).toEqual([900, 999]);
  });
  test("rangos imposibles", () => {
    expect(parseRange("bytes=1000-", 1000)).toBeNull();
    expect(parseRange("bytes=-", 1000)).toBeNull();
    expect(parseRange("items=0-1", 1000)).toBeNull();
    expect(parseRange(null, 1000)).toBeNull();
  });
});

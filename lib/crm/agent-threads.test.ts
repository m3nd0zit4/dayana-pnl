import { describe, expect, test } from "bun:test";
import { acceptsSave, isUiStateKey } from "./agent-threads";

describe("agent thread saves are append-only", () => {
  test("a new thread is always accepted", () => expect(acceptsSave(null, 0)).toBe(true));
  test("same or more events replace the stored copy", () => {
    expect(acceptsSave({ eventCount: 10 }, 10)).toBe(true);
    expect(acceptsSave({ eventCount: 10 }, 14)).toBe(true);
  });
  test("an older device with fewer events never wipes newer turns", () => {
    expect(acceptsSave({ eventCount: 10 }, 9)).toBe(false);
  });
});

test("only allow-listed UI state keys", () => {
  expect(isUiStateKey("contact-search-recents")).toBe(true);
  expect(isUiStateKey("anything-else")).toBe(false);
});

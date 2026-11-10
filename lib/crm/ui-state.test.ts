import { expect, test } from "bun:test";
import { isUiStateKey } from "./ui-state";

test("only allow-listed UI state keys", () => {
  expect(isUiStateKey("contact-search-recents")).toBe(true);
  expect(isUiStateKey("anything-else")).toBe(false);
});

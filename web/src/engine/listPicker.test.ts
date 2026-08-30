import { describe, it, expect } from "vitest";
import { canSelectOption } from "./listPicker";

const options = [
  { value: "ru", disabled: false },
  { value: "en", disabled: false },
  { value: "ja", disabled: true }, // coming-soon course, etc.
];

describe("canSelectOption (LINGO-026 bottom-sheet selection guard)", () => {
  it("allows selecting an enabled option present in the list", () => {
    expect(canSelectOption(options, "ru")).toBe(true);
    expect(canSelectOption(options, "en")).toBe(true);
  });

  it("refuses a disabled option even though it's present in the list", () => {
    expect(canSelectOption(options, "ja")).toBe(false);
  });

  it("refuses a value that isn't in the options list at all", () => {
    expect(canSelectOption(options, "de")).toBe(false);
  });

  it("treats an option with disabled omitted (undefined) as enabled", () => {
    expect(canSelectOption([{ value: "x" }], "x")).toBe(true);
  });

  it("is total over an empty options list", () => {
    expect(canSelectOption([], "anything")).toBe(false);
  });
});

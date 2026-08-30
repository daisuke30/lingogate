// Pure selection-guard logic for ui/ListPicker.tsx's BottomSheet (LINGO-026).
// This repo has no component-render test setup (no @testing-library/react —
// every existing UI test targets a pure engine/state function instead), so
// the sheet's "does tapping an option actually select it" rule is extracted
// here rather than left as inline JSX-handler logic, and BottomSheet calls
// this instead of re-deriving the guard — the same "component delegates to a
// tested pure function" pattern already used for FlashcardCard's grading gate
// (engine/grading.ts) and flip toggle.

export interface SelectableOption<T extends string> {
  value: T;
  disabled?: boolean;
}

/**
 * Should tapping the option with this value actually select it? False for an
 * unknown value (not present in `options` — can't happen from the rendered
 * list itself, but keeps the function total) or a disabled one (a coming-soon
 * course, the not-yet-built strict quiz mode, etc.) — a disabled option's
 * `<button>` is already unclickable via the native `disabled` attribute, but
 * this is the single source of truth the click handler defers to, so the
 * rule is provable without rendering anything.
 */
export function canSelectOption<T extends string>(options: SelectableOption<T>[], value: T): boolean {
  const opt = options.find((o) => o.value === value);
  return !!opt && !opt.disabled;
}

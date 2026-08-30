import { useState } from "react";
import { canSelectOption } from "../engine/listPicker";

/**
 * LINGO-026 (Katsuta-approved design): the single settings-picker pattern —
 * a list row showing "項目名（左）＋現在値（右）＋chevron", tapped to open a
 * bottom sheet with a radio list of options. Replaces every segmented-button
 * row (`.seg`) and side-by-side picker previously scattered across
 * SettingsView/OnboardingFlow with one consistent interaction.
 *
 * Dependency-free (no portal/modal library) — the sheet is a plain fixed-
 * position overlay + slide-up panel using the app's existing CSS variables.
 * Accessibility is intentionally minimal per the task's explicit scope
 * ("スクリーンリーダー配慮は最小限（role/aria-label程度）でよい"): a `dialog`
 * role + `aria-label` on the sheet, `aria-pressed` on each option, nothing
 * beyond that (no focus trap, no Escape-key handling).
 */

export interface ListPickerOption<T extends string> {
  value: T;
  /** Always the option's own name (LINGO-026: language pickers show
   * endonyms — 日本語/English/Русский — never a translated or flag form). */
  label: string;
  sub?: string;
  disabled?: boolean;
  /** e.g. "準備中" for a coming-soon course. */
  badge?: string;
}

/** The tappable row that opens the sheet — shows the setting's name, current
 * value, and a chevron. `value` is omitted (not "–") when there's nothing
 * meaningful to show yet. */
export function ListRow({
  label,
  sub,
  value,
  onClick,
}: {
  label: string;
  sub?: string;
  value?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="row row-link" onClick={onClick}>
      <div>
        <div className="label">{label}</div>
        {sub && <div className="sub">{sub}</div>}
      </div>
      <div className="row-value">
        {value && <span className="value">{value}</span>}
        <span className="chevron" aria-hidden="true">
          ›
        </span>
      </div>
    </button>
  );
}

/** The bottom sheet itself: a radio list of options + a close row. Renders
 * nothing when `open` is false. */
export function BottomSheet<T extends string>({
  open,
  title,
  options,
  selected,
  onSelect,
  onClose,
  closeLabel,
}: {
  open: boolean;
  title: string;
  options: ListPickerOption<T>[];
  selected: T;
  onSelect: (value: T) => void;
  onClose: () => void;
  closeLabel: string;
}) {
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-handle" />
        <div className="sheet-title">{title}</div>
        <div className="sheet-options">
          {options.map((opt) => {
            const isSelected = opt.value === selected;
            return (
              <button
                key={opt.value}
                type="button"
                className={"sheet-option" + (isSelected ? " on" : "")}
                disabled={opt.disabled}
                aria-pressed={isSelected}
                onClick={() => {
                  if (!canSelectOption(options, opt.value)) return;
                  onSelect(opt.value);
                  onClose();
                }}
              >
                <div>
                  <div className="label">
                    {opt.label}
                    {opt.badge && <span className="badge">{opt.badge}</span>}
                  </div>
                  {opt.sub && <div className="sub">{opt.sub}</div>}
                </div>
                {isSelected && (
                  <span className="sheet-check" aria-hidden="true">
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <button type="button" className="sheet-cancel" onClick={onClose}>
          {closeLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * Convenience combo: a ListRow that owns its own open/closed sheet state, so
 * a call site only needs to supply the options + current value + a setter —
 * this is the shape every picker in Settings/Onboarding now uses.
 */
export function ListPicker<T extends string>({
  label,
  sub,
  options,
  selected,
  onSelect,
  sheetTitle,
  closeLabel,
}: {
  label: string;
  sub?: string;
  options: ListPickerOption<T>[];
  selected: T;
  onSelect: (value: T) => void;
  /** Defaults to `label` when omitted (most pickers reuse the row's own name). */
  sheetTitle?: string;
  closeLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const currentLabel = options.find((o) => o.value === selected)?.label;
  return (
    <>
      <ListRow label={label} sub={sub} value={currentLabel} onClick={() => setOpen(true)} />
      <BottomSheet
        open={open}
        title={sheetTitle ?? label}
        options={options}
        selected={selected}
        onSelect={onSelect}
        onClose={() => setOpen(false)}
        closeLabel={closeLabel}
      />
    </>
  );
}

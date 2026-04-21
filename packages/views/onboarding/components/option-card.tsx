"use client";

import { Card } from "@multica/ui/components/ui/card";
import { Input } from "@multica/ui/components/ui/input";
import { cn } from "@multica/ui/lib/utils";

const OTHER_INPUT_MAX_LENGTH = 80;

/**
 * Clickable radio-style option used in the Step 1 questionnaire.
 *
 * Rendered as an ARIA radio so screen readers announce the question's
 * option set correctly — keep this consistent with the containing
 * `<fieldset role="radiogroup">` in `StepQuestionnaire`. Enter / Space
 * select, matching the existing clickable-card pattern used in
 * step-agent / step-runtime.
 */
export function OptionCard({
  selected,
  onSelect,
  label,
  description,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  description?: string;
}) {
  return (
    <Card
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "flex cursor-pointer flex-col gap-0.5 p-3 transition-colors",
        selected
          ? "border-primary ring-1 ring-primary"
          : "hover:border-foreground/20",
      )}
    >
      <div className="text-sm font-medium">{label}</div>
      {description && (
        <div className="text-xs text-muted-foreground">{description}</div>
      )}
    </Card>
  );
}

/**
 * "Other" variant of OptionCard. When selected, reveals an 80-char
 * text input as an escape hatch for answers that don't fit the
 * predefined options.
 *
 * Auto-focus: the input is conditionally rendered, so going from
 * unselected → selected mounts a fresh <Input>. `autoFocus` fires on
 * that mount — saving the user an extra click when they pick Other.
 *
 * Clearing `otherValue` when the user picks a different option in the
 * same group is the parent questionnaire's job, not this component's.
 * That keeps the input focus-stable while typing.
 */
export function OtherOptionCard({
  selected,
  onSelect,
  otherValue,
  onOtherChange,
  placeholder,
}: {
  selected: boolean;
  onSelect: () => void;
  otherValue: string;
  onOtherChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <Card
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={(e) => {
        // Don't re-fire onSelect when the click lands inside the input —
        // that would trigger a re-render that could feel jumpy during
        // mid-typing.
        if (e.target instanceof HTMLInputElement) return;
        onSelect();
      }}
      onKeyDown={(e) => {
        if (e.target instanceof HTMLInputElement) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "flex cursor-pointer flex-col gap-2 p-3 transition-colors",
        selected
          ? "border-primary ring-1 ring-primary"
          : "hover:border-foreground/20",
      )}
    >
      <div className="text-sm font-medium">Other</div>
      {selected && (
        <Input
          autoFocus
          type="text"
          value={otherValue}
          onChange={(e) => onOtherChange(e.target.value)}
          placeholder={placeholder}
          maxLength={OTHER_INPUT_MAX_LENGTH}
          className="h-8 text-sm"
          aria-label={placeholder}
        />
      )}
    </Card>
  );
}

export { OTHER_INPUT_MAX_LENGTH };

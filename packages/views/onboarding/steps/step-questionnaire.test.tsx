import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { QuestionnaireAnswers } from "@multica/core/onboarding";
import { StepQuestionnaire } from "./step-questionnaire";

const EMPTY_ANSWERS: QuestionnaireAnswers = {
  team_size: null,
  team_size_other: null,
  role: null,
  role_other: null,
  use_case: null,
  use_case_other: null,
};

function renderStep(initial: Partial<QuestionnaireAnswers> = {}) {
  const onSubmit = vi.fn();
  render(
    <StepQuestionnaire
      initial={{ ...EMPTY_ANSWERS, ...initial }}
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit };
}

/**
 * These tests lock down the questionnaire's submit-gate behavior —
 * the small set of rules a future refactor could easily break:
 *  - Empty = Skip (zero-friction path for evaluators)
 *  - Any answer = Continue
 *  - Picking "Other" without typing = disabled
 *  - Switching away from Other clears that question's *_other field
 *  - onSubmit is called with the current answer snapshot
 * See docs/onboarding-redesign-proposal.md §3.4 for the product spec.
 */
describe("StepQuestionnaire", () => {
  it("starts with 'Skip' when no questions are answered", () => {
    renderStep();
    const btn = screen.getByRole("button", { name: /skip/i });
    expect(btn).toBeEnabled();
  });

  it("switches CTA to 'Continue' once any question is answered", async () => {
    const user = userEvent.setup();
    renderStep();
    await user.click(screen.getByRole("radio", { name: /just me/i }));
    expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled();
  });

  it("disables CTA when Other is picked but no text is provided", async () => {
    const user = userEvent.setup();
    renderStep();
    // Q1 Other — there are three "Other" cards (one per question); the
    // first match is Q1's.
    const q1Other = screen.getAllByRole("radio", { name: /^other$/i })[0]!;
    await user.click(q1Other);
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });

  it("re-enables CTA once Other text is entered", async () => {
    const user = userEvent.setup();
    renderStep();
    const q1Other = screen.getAllByRole("radio", { name: /^other$/i })[0]!;
    await user.click(q1Other);
    const input = screen.getByPlaceholderText(/tell us about your team/i);
    await user.type(input, "Hackathon crew");
    expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled();
  });

  it("clears Other text when the user switches to a concrete option", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderStep();

    // Pick Q1 Other → type → pick Q1 Just me → submit. The submitted
    // payload should have team_size_other = null (cleared on switch).
    const q1Other = screen.getAllByRole("radio", { name: /^other$/i })[0]!;
    await user.click(q1Other);
    await user.type(
      screen.getByPlaceholderText(/tell us about your team/i),
      "large enterprise",
    );
    await user.click(screen.getByRole("radio", { name: /just me/i }));
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        team_size: "solo",
        team_size_other: null,
      }),
    );
  });

  it("calls onSubmit with empty answers when the user hits Skip", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderStep();
    await user.click(screen.getByRole("button", { name: /skip/i }));
    expect(onSubmit).toHaveBeenCalledWith(EMPTY_ANSWERS);
  });

  it("respects the initial prop (used for resume-after-back)", () => {
    renderStep({ team_size: "team", role: "developer" });
    expect(
      screen.getByRole("radio", { name: /my team/i }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("radio", { name: /software developer/i }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("submits the full answer set including all three questions", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderStep();

    await user.click(screen.getByRole("radio", { name: /just me/i }));
    await user.click(
      screen.getByRole("radio", { name: /software developer/i }),
    );
    await user.click(screen.getByRole("radio", { name: /write and ship code/i }));
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      team_size: "solo",
      team_size_other: null,
      role: "developer",
      role_other: null,
      use_case: "coding",
      use_case_other: null,
    });
  });
});

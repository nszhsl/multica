"use client";

import { useMemo, useState } from "react";
import { Button } from "@multica/ui/components/ui/button";
import type {
  QuestionnaireAnswers,
  Role,
  TeamSize,
  UseCase,
} from "@multica/core/onboarding";
import {
  OptionCard,
  OtherOptionCard,
} from "../components/option-card";

/**
 * Step 1 of the redesigned onboarding flow — welcome + 3-question
 * questionnaire on a single screen.
 *
 * Source of truth for the questionnaire schema lives in
 * `packages/core/onboarding/types.ts` and is documented in
 * docs/onboarding-redesign-proposal.md §3.4-§3.5. Summary:
 *
 *  Q1 team_size — who will use this workspace? (drives Onboarding
 *    Project sub-issue sorting, e.g. "Invite teammates" for teams)
 *  Q2 role — what best describes you? (drives Step 4 agent template)
 *  Q3 use_case — what do you want to do first? (drives Step 5 first
 *    issue prompt; `use_case_other` is embedded verbatim into the
 *    prompt when the user picks Other)
 *
 * Continue button logic:
 *  - 0 selections → button reads "Skip", variant outline (zero-
 *    friction path for evaluators per §3.4)
 *  - ≥1 selections → reads "Continue", default variant
 *  - Any question set to "other" but with empty text → disabled
 *    (text is required when Other is picked)
 *
 * The component holds draft answers in local state. The parent only
 * sees the final answer set when the user clicks Continue/Skip —
 * every keystroke into the Other input doesn't round-trip through
 * the store (the store will later be a network call, so spare it).
 *
 * `initial` lets the parent pre-fill from persisted state when a
 * user comes back to the questionnaire via the Back button (resume
 * semantics per §3.7: "回退不清空已保存的数据").
 */
export function StepQuestionnaire({
  initial,
  onSubmit,
}: {
  initial: QuestionnaireAnswers;
  onSubmit: (answers: QuestionnaireAnswers) => void;
}) {
  const [answers, setAnswers] = useState<QuestionnaireAnswers>(initial);

  // Selecting a concrete (non-"other") option should clear the matching
  // *_other field — we don't want stale Other text floating around in
  // the submitted payload. Selecting "other" leaves any existing text
  // intact so users can switch back without retyping.
  const setTeamSize = (v: TeamSize) => {
    setAnswers((a) => ({
      ...a,
      team_size: v,
      team_size_other: v === "other" ? a.team_size_other : null,
    }));
  };
  const setRole = (v: Role) => {
    setAnswers((a) => ({
      ...a,
      role: v,
      role_other: v === "other" ? a.role_other : null,
    }));
  };
  const setUseCase = (v: UseCase) => {
    setAnswers((a) => ({
      ...a,
      use_case: v,
      use_case_other: v === "other" ? a.use_case_other : null,
    }));
  };

  const anyAnswered =
    answers.team_size !== null ||
    answers.role !== null ||
    answers.use_case !== null;

  // "Other" picked but text empty ⇒ disable Continue. The only case
  // where we actively block the user from advancing; blanks / skipped
  // questions are otherwise fine.
  const otherIncomplete = useMemo(() => {
    const q1Bad =
      answers.team_size === "other" &&
      (answers.team_size_other ?? "").trim() === "";
    const q2Bad =
      answers.role === "other" && (answers.role_other ?? "").trim() === "";
    const q3Bad =
      answers.use_case === "other" &&
      (answers.use_case_other ?? "").trim() === "";
    return q1Bad || q2Bad || q3Bad;
  }, [answers]);

  const submit = () => onSubmit(answers);

  return (
    <div className="flex w-full flex-col items-center gap-8">
      <div className="flex flex-col gap-3 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">
          Welcome to Multica
        </h1>
        <p className="text-base text-muted-foreground">
          A few quick questions so we can tailor your workspace. Skip any
          that don't apply.
        </p>
      </div>

      <fieldset
        role="radiogroup"
        aria-label="Who will use this workspace?"
        className="flex w-full flex-col gap-2.5"
      >
        <legend className="mb-1 text-sm font-medium">
          Who will use this workspace?
        </legend>
        <OptionCard
          selected={answers.team_size === "solo"}
          onSelect={() => setTeamSize("solo")}
          label="Just me"
        />
        <OptionCard
          selected={answers.team_size === "team"}
          onSelect={() => setTeamSize("team")}
          label="My team (2–10 people)"
        />
        <OptionCard
          selected={answers.team_size === "evaluating"}
          onSelect={() => setTeamSize("evaluating")}
          label="Just exploring for now"
        />
        <OtherOptionCard
          selected={answers.team_size === "other"}
          onSelect={() => setTeamSize("other")}
          otherValue={answers.team_size_other ?? ""}
          onOtherChange={(v) =>
            setAnswers((a) => ({ ...a, team_size_other: v }))
          }
          placeholder="Tell us about your team"
        />
      </fieldset>

      <fieldset
        role="radiogroup"
        aria-label="What best describes you?"
        className="flex w-full flex-col gap-2.5"
      >
        <legend className="mb-1 text-sm font-medium">
          What best describes you?
        </legend>
        <OptionCard
          selected={answers.role === "developer"}
          onSelect={() => setRole("developer")}
          label="Software developer"
        />
        <OptionCard
          selected={answers.role === "product_lead"}
          onSelect={() => setRole("product_lead")}
          label="Product / project lead"
        />
        <OptionCard
          selected={answers.role === "writer"}
          onSelect={() => setRole("writer")}
          label="Writer or content creator"
        />
        <OptionCard
          selected={answers.role === "founder"}
          onSelect={() => setRole("founder")}
          label="Founder / solo operator"
        />
        <OtherOptionCard
          selected={answers.role === "other"}
          onSelect={() => setRole("other")}
          otherValue={answers.role_other ?? ""}
          onOtherChange={(v) => setAnswers((a) => ({ ...a, role_other: v }))}
          placeholder="Tell us what you do"
        />
      </fieldset>

      <fieldset
        role="radiogroup"
        aria-label="What do you want to do first?"
        className="flex w-full flex-col gap-2.5"
      >
        <legend className="mb-1 text-sm font-medium">
          What do you want to do first?
        </legend>
        <OptionCard
          selected={answers.use_case === "coding"}
          onSelect={() => setUseCase("coding")}
          label="Write and ship code"
        />
        <OptionCard
          selected={answers.use_case === "planning"}
          onSelect={() => setUseCase("planning")}
          label="Plan and manage projects"
        />
        <OptionCard
          selected={answers.use_case === "writing_research"}
          onSelect={() => setUseCase("writing_research")}
          label="Research or write"
        />
        <OptionCard
          selected={answers.use_case === "explore"}
          onSelect={() => setUseCase("explore")}
          label="Just explore what's possible"
        />
        <OtherOptionCard
          selected={answers.use_case === "other"}
          onSelect={() => setUseCase("other")}
          otherValue={answers.use_case_other ?? ""}
          onOtherChange={(v) =>
            setAnswers((a) => ({ ...a, use_case_other: v }))
          }
          placeholder="Tell us what you'd like to do"
        />
      </fieldset>

      <Button
        size="lg"
        className="w-full"
        variant={anyAnswered ? "default" : "outline"}
        disabled={otherIncomplete}
        onClick={submit}
      >
        {anyAnswered ? "Continue" : "Skip"}
      </Button>
    </div>
  );
}

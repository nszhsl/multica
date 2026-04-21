"use client";

import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { setCurrentWorkspace } from "@multica/core/platform";
import {
  useOnboardingStore,
  type QuestionnaireAnswers,
} from "@multica/core/onboarding";
import { workspaceListOptions } from "@multica/core/workspace/queries";
import type { Agent, AgentRuntime, Workspace } from "@multica/core/types";
import { StepQuestionnaire } from "./steps/step-questionnaire";
import { StepWorkspace } from "./steps/step-workspace";
import { StepRuntime } from "./steps/step-runtime";
import { StepAgent } from "./steps/step-agent";
import { StepComplete } from "./steps/step-complete";

/**
 * Step identifiers for the orchestrator's *render* state. Distinct from
 * the server-side `OnboardingStep` enum in core/onboarding/types.ts,
 * which tracks persisted progress — those will converge when Step 5
 * (first-issue) lands and flow transitions are fully store-driven.
 * Today the orchestrator runs off local state and only persists the
 * questionnaire answers + current_step into the store at each
 * transition.
 *
 *   questionnaire → workspace → runtime → agent → complete
 *
 * Branches: no-runtime or skip-runtime jumps past agent straight to
 * complete (can't build a CreateAgent request without a runtime_id).
 */
export type OnboardingStep =
  | "questionnaire"
  | "workspace"
  | "runtime"
  | "agent"
  | "complete";

/**
 * Shared onboarding orchestrator. Renders the current step and drives
 * transitions between them. Platform shells (desktop overlay, web page)
 * wrap this component — they own the chrome, not the content.
 *
 * `onComplete` receives the newly-created workspace (if any) so the
 * shell can navigate the user there. For users who already had a
 * workspace and skipped the create step, `onComplete` is called with
 * `undefined` — the shell should just close the overlay without
 * navigating.
 */
export function OnboardingFlow({
  onComplete,
  runtimeInstructions,
}: {
  onComplete: (workspace?: Workspace) => void;
  /**
   * Platform-specific instructions rendered inside the runtime step.
   * Web passes `<CliInstallInstructions />` (tells users how to install
   * the CLI). Desktop omits this — its bundled daemon auto-starts, so
   * the same guidance would be noise.
   */
  runtimeInstructions?: React.ReactNode;
}) {
  const [step, setStep] = useState<OnboardingStep>("questionnaire");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [runtime, setRuntime] = useState<AgentRuntime | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);

  // Persisted questionnaire answers — rendered as the Step 1 initial
  // state so users who hit Back from a later step see their previous
  // answers (resume-after-back per §3.7 of the proposal).
  const storedQuestionnaire = useOnboardingStore(
    (s) => s.state.questionnaire,
  );
  const advance = useOnboardingStore((s) => s.advance);

  // Fallback when the user skipped workspace creation (already had one).
  // We use the first workspace in the list as the runtime-step context.
  // If the user has zero and skipped, runtime step won't render and the
  // flow completes without a workspace result.
  const { data: workspaces = [] } = useQuery(workspaceListOptions());
  const runtimeWorkspace = workspace ?? workspaces[0] ?? null;

  const handleQuestionnaireSubmit = useCallback(
    (answers: QuestionnaireAnswers) => {
      // Persist the answers + advance the stored current_step. Fire and
      // forget — today `advance` is a synchronous in-memory write; once
      // backed by PATCH /api/me/onboarding the render transition still
      // feels instant because we don't await it (the UI has nothing
      // useful to show while a 50ms network call is in flight).
      void advance({
        questionnaire: answers,
        current_step: "workspace",
      });
      setStep("workspace");
    },
    [advance],
  );

  const handleWorkspaceCreated = useCallback((ws: Workspace) => {
    setWorkspace(ws);
    // Publish the newly-created workspace as "current" so the API client
    // sends `X-Workspace-Slug` on subsequent calls (runtime list, agent
    // create). Onboarding lives outside the WorkspaceRouteLayout that
    // normally owns this singleton, so nothing else sets it for us. The
    // layout will re-set it (idempotently) when the user lands on
    // /<slug>/issues after onComplete.
    setCurrentWorkspace(ws.slug, ws.id);
    setStep("runtime");
  }, []);

  const handleWorkspaceSkip = useCallback(() => {
    // Skip is only exposed when the user already has a workspace — so
    // there's always a runtime context to advance into. The zero-ws
    // case is a hard gate (no Skip button shown), enforced by
    // passing `onSkip={undefined}` below.
    setStep("runtime");
  }, []);

  const handleRuntimeNext = useCallback((rt: AgentRuntime | null) => {
    setRuntime(rt);
    // No runtime → can't build a CreateAgentRequest (runtime_id is
    // required), so skip the agent step entirely.
    setStep(rt ? "agent" : "complete");
  }, []);

  const handleAgentCreated = useCallback((created: Agent) => {
    setAgent(created);
    setStep("complete");
  }, []);

  const handleAgentSkip = useCallback(() => {
    setStep("complete");
  }, []);

  const handleFinish = useCallback(() => {
    onComplete(workspace ?? undefined);
  }, [workspace, onComplete]);

  return (
    <>
      {step === "questionnaire" && (
        <StepQuestionnaire
          initial={storedQuestionnaire}
          onSubmit={handleQuestionnaireSubmit}
        />
      )}
      {step === "workspace" && (
        <StepWorkspace
          onCreated={handleWorkspaceCreated}
          onSkip={
            workspaces.length > 0 ? handleWorkspaceSkip : undefined
          }
        />
      )}
      {step === "runtime" && runtimeWorkspace && (
        <StepRuntime
          wsId={runtimeWorkspace.id}
          onNext={handleRuntimeNext}
          instructions={runtimeInstructions}
        />
      )}
      {step === "agent" && runtime && (
        <StepAgent
          runtime={runtime}
          onCreated={handleAgentCreated}
          onSkip={handleAgentSkip}
        />
      )}
      {step === "complete" && (
        <StepComplete agent={agent} onFinish={handleFinish} />
      )}
    </>
  );
}

export function buildPlanningOnlyPrompt(input: {
  taskPrompt: string;
  repoRules: string;
}): string {
  return [
    "You are starting a new child session.",
    "Your first response must be a plan ONLY.",
    "Do not use tools. Do not edit files. Do not propose code diffs yet.",
    "Return a structured plan that is specific, ordered, and testable.",
    "",
    "Task (from orchestrator):",
    input.taskPrompt.trim(),
    "",
    "Repo-specific rules and constraints:",
    input.repoRules.trim(),
    "",
    "Plan format:",
    "- 6-12 bullet steps",
    "- include which files/modules you will touch",
    "- include how you will verify (commands)",
  ].join("\n");
}

export function buildExecutionPromptFromApprovedPlan(input: {
  approvedPlan: string;
  taskPrompt: string;
  repoRules: string;
}): string {
  return buildExecutionPromptFromApprovedPlanWithUserAnswers({
    approvedPlan: input.approvedPlan,
    taskPrompt: input.taskPrompt,
    repoRules: input.repoRules,
    userAnswers: null,
  });
}

export function buildExecutionPromptFromApprovedPlanWithUserAnswers(input: {
  approvedPlan: string;
  taskPrompt: string;
  repoRules: string;
  userAnswers: string | null;
}): string {
  const answers = (input.userAnswers ?? "").trim();

  return [
    "Proceed with execution using the approved plan.",
    "Follow repo-specific rules.",
    ...(answers.length
      ? [
        "",
        "User answers to your questions:",
        answers,
      ]
      : []),
    "",
    "Approved plan:",
    input.approvedPlan.trim(),
    "",
    "Task (from orchestrator):",
    input.taskPrompt.trim(),
    "",
    "Repo-specific rules and constraints:",
    input.repoRules.trim(),
  ].join("\n");
}

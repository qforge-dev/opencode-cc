import { describe, expect, test } from "bun:test";

import { detectChildQuestions } from "./child-questions.ts";

describe("detectChildQuestions", () => {
  test("detects a Questions section and extracts it", () => {
    const input = [
      "## Plan",
      "- Step 1",
      "",
      "## Questions:",
      "- What is the base branch?",
      "- Should we support Windows?",
      "",
      "## Verification",
      "- bun run typecheck",
    ].join("\n");

    const result = detectChildQuestions(input);
    expect(result.hasQuestions).toBe(true);
    expect(result.source).toBe("section");
    expect(result.questionsText).toContain("What is the base branch?");
    expect(result.questionsText).toContain("Should we support Windows?");
    expect(result.questionsText).not.toContain("Verification");
  });

  test("uses a conservative heuristic for question bullets", () => {
    const input = [
      "Here are a few clarifications:",
      "- Do we need to support Node 18?",
      "- Is the output expected to be JSON?",
      "We can proceed once answered.",
    ].join("\n");

    const result = detectChildQuestions(input);
    expect(result.hasQuestions).toBe(true);
    expect(result.source).toBe("heuristic");
    expect(result.questionsText).toContain("Do we need to support Node 18?");
    expect(result.questionsText).toContain("Is the output expected to be JSON?");
  });
});

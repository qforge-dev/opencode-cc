export type ChildQuestionsDetection = {
  hasQuestions: boolean;
  questionsText: string | null;
  source: "section" | "heuristic" | null;
};

export function detectChildQuestions(text: string): ChildQuestionsDetection {
  const normalized = normalizeText(text);
  const lines = normalized.split("\n");

  const section = extractQuestionsSection(lines);
  if (section !== null) {
    const cleaned = trimBlankEdges(section).join("\n").trim();
    if (cleaned.length === 0) return { hasQuestions: false, questionsText: null, source: null };
    return { hasQuestions: true, questionsText: cleaned, source: "section" };
  }

  const heuristic = extractHeuristicQuestionLines(lines);
  if (heuristic !== null) {
    const cleaned = trimBlankEdges(heuristic).join("\n").trim();
    if (cleaned.length === 0) return { hasQuestions: false, questionsText: null, source: null };
    return { hasQuestions: true, questionsText: cleaned, source: "heuristic" };
  }

  return { hasQuestions: false, questionsText: null, source: null };
}

function extractQuestionsSection(lines: string[]): string[] | null {
  const headerIndex = findQuestionsHeaderLineIndex(lines);
  if (headerIndex === null) return null;

  const sectionLines: string[] = [];
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (isLikelySectionBoundary(line) && sectionLines.length > 0) break;
    if (looksLikeCodeFence(line) && sectionLines.length > 0) break;
    sectionLines.push(line);
  }

  const trimmed = trimBlankEdges(sectionLines);
  if (trimmed.length === 0) return null;
  return trimmed;
}

function findQuestionsHeaderLineIndex(lines: string[]): number | null {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (isQuestionsHeader(line)) return i;
  }
  return null;
}

function extractHeuristicQuestionLines(lines: string[]): string[] | null {
  const picked: string[] = [];
  let qPrefixCount = 0;

  for (const line of lines) {
    if (isQPrefixLine(line)) {
      picked.push(line);
      qPrefixCount += 1;
      continue;
    }

    if (isQuestionBulletLine(line)) {
      picked.push(line);
    }
  }

  const questionCount = picked.filter((l) => l.includes("?")).length;
  if (qPrefixCount >= 1) return picked;
  if (questionCount >= 2) return picked;
  return null;
}

function isQuestionsHeader(line: string): boolean {
  const normalized = line.trim().toLowerCase();
  if (!normalized.length) return false;

  const withoutMarkdown = normalized.replace(/^#{1,6}\s+/, "");
  const withoutColon = withoutMarkdown.replace(/\s*:\s*$/, "");

  const candidates = [
    "questions",
    "open questions",
    "clarifying questions",
    "questions for you",
    "questions for orchestrator",
    "questionnaire",
    "missing info",
    "unknowns",
  ];

  return candidates.includes(withoutColon);
}

function isLikelySectionBoundary(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.length) return false;
  if (/^#{1,6}\s+\S/.test(trimmed)) return true;
  if (/^\*\*[^*]+\*\*\s*$/.test(trimmed)) return true;
  if (/^[A-Za-z][A-Za-z0-9 /()_-]{0,40}:\s*$/.test(trimmed)) return true;
  return false;
}

function looksLikeCodeFence(line: string): boolean {
  return /^\s*```/.test(line);
}

function isQPrefixLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.length) return false;
  if (!/^q\d*\s*[:\-]/i.test(trimmed)) return false;
  return trimmed.includes("?");
}

function isQuestionBulletLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.length) return false;
  if (!trimmed.includes("?")) return false;
  if (/^[-*+]\s+\S/.test(trimmed)) return true;
  if (/^\d+[.)]\s+\S/.test(trimmed)) return true;
  if (/^\(?[a-zA-Z]\)\s+\S/.test(trimmed)) return true;
  return false;
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;

  while (start < end && !(lines[start] ?? "").trim().length) start += 1;
  while (end > start && !(lines[end - 1] ?? "").trim().length) end -= 1;

  return lines.slice(start, end);
}

function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

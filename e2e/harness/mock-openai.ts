import crypto from "node:crypto";

export type MockOpenAiServer = {
  baseUrl: string;
  getRequests: () => Array<{ url: string; method: string; body: unknown }>;
  stop: () => Promise<void>;
};

type ChatMessage = {
  role: string;
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
  name?: string;
  tool_call_id?: string;
};

type ChatCompletionRequest = {
  model?: string;
  messages?: Array<ChatMessage>;
  stream?: boolean;
};

export async function startMockOpenAiServer(input: {
  hostname: string;
  port: number;
}): Promise<MockOpenAiServer> {
  const captured: Array<{ url: string; method: string; body: unknown }> = [];
  const server = Bun.serve({
    hostname: input.hostname,
    port: input.port,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
        const body = (await req.json()) as ChatCompletionRequest;
        captured.push({ url: url.pathname, method: req.method, body });
        const response = buildResponse(body);
        if (body.stream) {
          return new Response(streamResponse(response), {
            status: 200,
            headers: {
              "content-type": "text/event-stream",
              "cache-control": "no-cache",
              connection: "keep-alive",
            },
          });
        }

        return new Response(JSON.stringify(response) + "\n", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (req.method === "POST" && url.pathname === "/v1/responses") {
        const body = await req.json();
        captured.push({ url: url.pathname, method: req.method, body });
        return new Response(JSON.stringify({ error: { message: "not_implemented" } }) + "\n", {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }

      if (req.method === "GET" && url.pathname === "/health") {
        return new Response("ok\n", { status: 200 });
      }

      return new Response("not_found\n", { status: 404 });
    },
  });

  return {
    baseUrl: `http://${input.hostname}:${server.port}`,
    getRequests: () => captured.slice(),
    stop: async () => {
      server.stop(true);
    },
  };
}

function buildResponse(req: ChatCompletionRequest): any {
  const model = normalizeModel(req.model ?? "");
  const messages = req.messages ?? [];

  const latestUserText = findLatestUserText(messages);
  if (looksLikeSummarizationRequest(latestUserText)) {
    const extracted = extractSummarizationText(latestUserText);
    const compact = extracted.length ? extracted : latestUserText;
    const summary = compact.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 3).join(" ");
    return buildTextResponse(model || "mock", summary.length ? summary : "ok");
  }

  if (model === "orchestrator") {
    return buildOrchestratorResponse(model, messages);
  }

  if (model === "plan") {
    return buildPlanResponse(model);
  }

  if (model === "build") {
    return buildBuildResponse(model, messages);
  }

  return buildTextResponse(model || "mock", "Unhandled model");
}

function buildOrchestratorResponse(model: string, messages: Array<ChatMessage>): any {
  const toolResultByName = extractToolResults(messages);
  const created = toolResultByName.get("session_create") ?? null;
  const prompted = toolResultByName.get("session_prompt") ?? null;

  if (!created) {
    return buildToolCallResponse(model, {
      name: "session_create",
      arguments: { title: "Check git status" },
    });
  }

  if (!prompted) {
    const createdData = tryParseJson(created) as any;
    const childSessionID = createdData?.sessionID ?? createdData?.data?.sessionID ?? null;
    if (!childSessionID) {
      return buildTextResponse(model, "Failed to read child session id from session_create result.");
    }

    return buildToolCallResponse(model, {
      name: "session_prompt",
      arguments: {
        sessionID: String(childSessionID),
        prompt: "Run `git status -sb` and report what you see.",
        agent: "build",
      },
    });
  }

  const latestUserText = findLatestUserText(messages);
  if (latestUserText.includes("[Child session") && latestUserText.includes("completed")) {
    const excerpt = latestUserText.trim();
    return buildTextResponse(model, `Here is what is going on:\n\n${excerpt}`);
  }

  return buildTextResponse(model, "Delegated to a child session. Waiting for results.");
}

function buildPlanResponse(model: string): any {
  const content = [
    "## Plan",
    "- Run `git status -sb`",
    "- Summarize the repository status",
    "",
    "## Verification",
    "- None",
  ].join("\n");

  return buildTextResponse(model, content);
}

function buildBuildResponse(model: string, messages: Array<ChatMessage>): any {
  const toolResultByName = extractToolResults(messages);
  const bashResult = toolResultByName.get("bash") ?? null;

  if (!bashResult) {
    return buildToolCallResponse(model, {
      name: "bash",
      arguments: { command: "git status -sb" },
    });
  }

  const tokenLine = extractForwardTokenLine(messages);
  const base = `git status output:\n\n${String(bashResult).trim()}`;
  const content = tokenLine ? `${base}\n\n${tokenLine}` : base;
  return buildTextResponse(model, content);
}

function extractForwardTokenLine(messages: Array<ChatMessage>): string | null {
  const token = findLatestForwardToken(messages);
  if (!token) return null;
  return `opencode_cc_forward_token: ${token}`;
}

function findLatestForwardToken(messages: Array<ChatMessage>): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg) continue;
    if (msg.role !== "user") continue;
    const content = typeof msg.content === "string" ? msg.content : "";
    const token = extractForwardTokenFromText(content);
    if (token) return token;
  }
  return null;
}

function extractForwardTokenFromText(text: string): string | null {
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    const prefix = "opencode_cc_forward_token: ";
    if (!trimmed.startsWith(prefix)) continue;
    const token = trimmed.slice(prefix.length).trim();
    return token.length ? token : null;
  }
  return null;
}

function buildToolCallResponse(
  model: string,
  tool: { name: string; arguments: Record<string, unknown> },
): any {
  const toolCallID = `call_${crypto.randomBytes(8).toString("hex")}`;
  return {
    id: `chatcmpl_${crypto.randomBytes(8).toString("hex")}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: toolCallID,
              type: "function",
              function: {
                name: tool.name,
                arguments: JSON.stringify(tool.arguments),
              },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

function buildTextResponse(model: string, content: string): any {
  return {
    id: `chatcmpl_${crypto.randomBytes(8).toString("hex")}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

function streamResponse(full: any): ReadableStream {
  const encoder = new TextEncoder();
  const id = full?.id ?? `chatcmpl_${crypto.randomBytes(8).toString("hex")}`;
  const model = full?.model ?? "mock";
  const created = full?.created ?? Math.floor(Date.now() / 1000);
  const choice = full?.choices?.[0] ?? null;
  const message = choice?.message ?? {};
  const toolCalls = message?.tool_calls ?? null;
  const content = typeof message?.content === "string" ? message.content : null;
  const finishReason = choice?.finish_reason ?? "stop";

  const chunks: Array<any> = [];
  chunks.push({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta: { role: "assistant" },
        finish_reason: null,
      },
    ],
  });

  if (Array.isArray(toolCalls) && toolCalls.length) {
    const first = toolCalls[0];
    chunks.push({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: first.id,
                type: first.type,
                function: {
                  name: first.function?.name,
                  arguments: first.function?.arguments,
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    chunks.push({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: finishReason,
        },
      ],
    });
  } else if (content !== null) {
    chunks.push({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [
        {
          index: 0,
          delta: { content },
          finish_reason: null,
        },
      ],
    });
    chunks.push({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: finishReason,
        },
      ],
    });
  }

  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
}

function normalizeModel(model: string): string {
  const trimmed = String(model ?? "").trim();
  if (!trimmed.length) return "";
  const lastSegment = trimmed.includes("/") ? trimmed.split("/").at(-1) : trimmed;
  return String(lastSegment ?? trimmed).trim();
}

function extractToolResults(messages: Array<ChatMessage>): Map<string, string> {
  const results = new Map<string, string>();
  const toolNameByCallID = new Map<string, string>();

  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const calls = msg.tool_calls ?? [];
    for (const call of calls) {
      const id = call?.id ?? "";
      const name = call?.function?.name ?? "";
      if (!id.length || !name.length) continue;
      if (!toolNameByCallID.has(id)) toolNameByCallID.set(id, name);
    }
  }

  for (const msg of messages) {
    if (msg.role !== "tool") continue;

    const callID = msg.tool_call_id ?? "";
    const inferredName = msg.name ?? inferToolNameFromContent(msg.content);
    const name = toolNameByCallID.get(callID) ?? inferredName;
    const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "");
    if (name && !results.has(name)) results.set(name, content);
  }

  return results;
}

function inferToolNameFromContent(content: unknown): string | null {
  if (typeof content !== "string") return null;
  const parsed = tryParseJson(content);
  if (parsed && typeof parsed === "object") {
    const anyParsed = parsed as any;
    if (typeof anyParsed?.tool === "string") return anyParsed.tool;
    if (typeof anyParsed?.name === "string") return anyParsed.name;
  }
  return null;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function findLatestUserText(messages: Array<ChatMessage>): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg) continue;
    if (msg.role !== "user") continue;
    const content = msg.content;
    if (typeof content === "string") return content;
  }
  return "";
}

function looksLikeSummarizationRequest(text: string): boolean {
  const t = text.toLowerCase();
  if (!t.length) return false;
  if (t.includes("the following is the text to summarize")) return true;
  if (t.includes("<text>") && t.includes("</text>")) return true;
  return false;
}

function extractSummarizationText(text: string): string {
  const start = text.indexOf("<text>");
  const end = text.indexOf("</text>");
  if (start >= 0 && end > start) {
    return text.slice(start + "<text>".length, end).trim();
  }
  return "";
}

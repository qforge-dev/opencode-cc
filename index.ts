import type { Plugin } from "@opencode-ai/plugin";

import { agent as opencodeAgentExample } from "./agents/opencode-agent-example.ts";
import { command } from "./commands/example.ts";
import { createExampleTool } from "./tools/example";

const OpencodeCC: Plugin = async (_input) => {
  const exampleTool = createExampleTool();

  return {
    config: async (config) => {
      config.agent = config.agent || {};
      config.command = config.command || {};
      config.agent["opencode-agent-example"] = opencodeAgentExample;
      config.command["example"] = command;
    },
    tool: {
      example: exampleTool,
    },
  };
};

export default OpencodeCC;

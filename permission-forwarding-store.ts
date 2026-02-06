import type { Permission } from "@opencode-ai/sdk";

type ForwardedPermissionStatus = "allow" | "deny";

type DecisionStore = {
  allow: Set<string>;
  deny: Set<string>;
};

export class PermissionForwardingStore {
  private readonly permissionByID = new Map<string, Permission>();
  private readonly decisionsByOrchestratorSessionID = new Map<string, DecisionStore>();

  public capturePermission(permission: Permission): void {
    this.permissionByID.set(permission.id, permission);
  }

  public getPermission(permissionID: string): Permission | null {
    return this.permissionByID.get(permissionID) ?? null;
  }

  public captureReply(orchestratorSessionID: string, permission: Permission, response: string): void {
    const decision = normalizePermissionReply(response);
    if (!decision) return;

    const store = this.getOrCreateDecisionStore(orchestratorSessionID);
    const keys = toDecisionKeys(permission);

    for (const key of keys) {
      if (decision === "allow") {
        store.allow.add(key);
        store.deny.delete(key);
        continue;
      }

      store.deny.add(key);
      store.allow.delete(key);
    }
  }

  public getForwardedStatus(orchestratorSessionID: string, permission: Permission): ForwardedPermissionStatus | null {
    const store = this.decisionsByOrchestratorSessionID.get(orchestratorSessionID);
    if (!store) return null;

    const keys = toDecisionKeys(permission);
    for (const key of keys) {
      if (store.deny.has(key)) return "deny";
    }
    for (const key of keys) {
      if (store.allow.has(key)) return "allow";
    }

    return null;
  }

  private getOrCreateDecisionStore(orchestratorSessionID: string): DecisionStore {
    const existing = this.decisionsByOrchestratorSessionID.get(orchestratorSessionID);
    if (existing) return existing;

    const created: DecisionStore = {
      allow: new Set<string>(),
      deny: new Set<string>(),
    };
    this.decisionsByOrchestratorSessionID.set(orchestratorSessionID, created);
    return created;
  }
}

function normalizePermissionReply(response: string): ForwardedPermissionStatus | null {
  if (response === "always") return "allow";
  if (response === "reject") return "deny";
  return null;
}

function toDecisionKeys(permission: Permission): string[] {
  const patterns = normalizePatterns(permission.pattern);
  return patterns.map((pattern) => `${permission.type}:${pattern}`);
}

function normalizePatterns(pattern: Permission["pattern"]): string[] {
  if (typeof pattern === "string") return [pattern];
  if (Array.isArray(pattern)) return pattern;
  return [""];
}

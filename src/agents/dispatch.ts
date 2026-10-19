import { antigravityAdapter } from './antigravity.js';
import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { opencodeAdapter } from './opencode.js';
import { AGENTS, UnsupportedScope, step, type AgentAdapter, type AgentId, type AgentScope, type Context, type Step } from './types.js';

export const ADAPTERS: Record<AgentId, AgentAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  opencode: opencodeAdapter,
  antigravity: antigravityAdapter,
};

export type Action = 'install' | 'update' | 'uninstall' | 'doctor';

export interface Request {
  // Agent names. Empty, or "all", means every agent. Install and update use the ones set up here,
  // and uninstall and doctor use all of them.
  agents?: string[];
  // Concrete scope. "all" means every scope the agent supports (uninstall and update only).
  scope?: AgentScope | 'all';
}

export const isAgentId = (name: string): name is AgentId => (AGENTS as readonly string[]).includes(name);

// Names the agents to act on. Throws on an unknown name, so a typo never silently does nothing.
export const resolveAgents = (names: string[] | undefined, ctx: Context, implicit: 'present' | 'all'): { explicit: boolean; agents: AgentId[] } => {
  if (!names || names.length === 0 || names.includes('all')) {
    const agents = AGENTS.filter((id) => implicit === 'all' || ADAPTERS[id].present(ctx));
    return { explicit: false, agents: [...agents] };
  }
  const unknown = names.filter((name) => !isAgentId(name));
  if (unknown.length > 0) {
    throw new Error(`Unknown agent: ${unknown.join(', ')}. Valid: ${AGENTS.join(', ')}, or all.`);
  }
  return { explicit: true, agents: names as AgentId[] };
};

// Runs one action over the chosen agents, one after another. An agent that does not support the requested scope
// is skipped with its reason when the agents were not named. When they were named, that is an error.
export const runAction = async (action: Action, request: Request, ctx: Context): Promise<Step[]> => {
  const implicit = action === 'install' || action === 'update' ? 'present' : 'all';
  const { explicit, agents } = resolveAgents(request.agents, ctx, implicit);
  const steps: Step[] = [];

  for (const id of agents) {
    const adapter = ADAPTERS[id];
    if (action === 'doctor') {
      steps.push(...(await adapter.doctor(ctx)));
      continue;
    }
    const scopes: AgentScope[] = request.scope === 'all' ? [...adapter.scopes] : [request.scope ?? 'global'];
    for (const scope of scopes) {
      if (!adapter.scopes.includes(scope)) {
        const message = `${id} does not support the ${scope} scope. It supports ${adapter.scopes.join(', ')}.`;
        if (explicit && request.scope !== 'all') {
          throw new UnsupportedScope(message);
        }
        steps.push(step(id, action, 'skipped', message));
        continue;
      }
      try {
        const run = action === 'install' ? adapter.install : action === 'update' ? adapter.update : adapter.uninstall;
        steps.push(...(await run.call(adapter, ctx, scope)));
      } catch (error) {
        if (error instanceof UnsupportedScope && !explicit) {
          steps.push(step(id, action, 'skipped', error.message));
        } else {
          steps.push(step(id, action, 'error', (error as Error).message));
        }
      }
    }
  }
  return steps;
};

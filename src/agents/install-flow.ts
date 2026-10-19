import { AGENTS, type AgentScope, type Context, type Step } from './types.js';
import { ADAPTERS } from './dispatch.js';

export interface InstallArgs {
  agents: string[];
  scope?: string;
  projectDir?: string;
  source?: string;
  dryRun: boolean;
  yes: boolean;
}

// Reads the arguments after `install`. Unknown options are an error, so a typo never runs a default install.
export const parseInstallArgs = (rest: string[]): InstallArgs => {
  const parsed: InstallArgs = { agents: [], dryRun: false, yes: false };
  const withValue = new Set(['--scope', '--project-dir', '--source']);
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (withValue.has(arg)) {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${arg} needs a value.`);
      }
      if (arg === '--scope') parsed.scope = value;
      if (arg === '--project-dir') parsed.projectDir = value;
      if (arg === '--source') parsed.source = value;
      index += 1;
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--yes' || arg === '-y') {
      parsed.yes = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      parsed.agents.push(arg);
    }
  }
  return parsed;
};

export interface Answers {
  agents?: string[];
  scope?: AgentScope;
  projectDir?: string;
}

// "1,3" or "claude codex" or "all" or an empty answer (which means all set up here). Undefined when invalid.
export const parseAgentAnswer = (answer: string): string[] | undefined => {
  const tokens = answer.split(/[\s,]+/).filter((token) => token !== '');
  if (tokens.length === 0 || tokens.includes('all')) {
    return ['all'];
  }
  const agents: string[] = [];
  for (const token of tokens) {
    const number = Number(token);
    const name = Number.isInteger(number) && number >= 1 && number <= AGENTS.length ? AGENTS[number - 1] : token;
    if (!(AGENTS as readonly string[]).includes(name)) {
      return undefined;
    }
    if (!agents.includes(name)) {
      agents.push(name);
    }
  }
  return agents;
};

// "" or "1" is global, "2" is project, "3" is local. The names work too. Undefined when invalid.
export const parseScopeAnswer = (answer: string): AgentScope | undefined => {
  const value = answer.trim().toLowerCase();
  const map: Record<string, AgentScope> = { '': 'global', '1': 'global', global: 'global', user: 'global', '2': 'project', project: 'project', '3': 'local', local: 'local' };
  return map[value];
};

export type Ask = (question: string) => Promise<string>;

// Asks only for what the flags did not give. Keeps asking until an answer is valid.
export const completeAnswers = async (given: Answers, ctx: Context, ask: Ask, out: (line: string) => void): Promise<Required<Pick<Answers, 'agents' | 'scope'>> & { projectDir?: string }> => {
  let agents = given.agents;
  if (!agents) {
    out('Agents:');
    AGENTS.forEach((id, index) => {
      out(`  ${index + 1}) ${id.padEnd(12)} ${ADAPTERS[id].present(ctx) ? 'set up here' : 'not found here'}`);
    });
    for (;;) {
      agents = parseAgentAnswer(await ask('Which agents? Numbers or names, comma separated. Enter for all set up here: '));
      if (agents) break;
      out('Not a valid choice. Use numbers 1-4, names, or all.');
    }
  }

  let scope = given.scope;
  if (!scope) {
    for (;;) {
      scope = parseScopeAnswer(await ask('Scope: 1) global, every folder (default)  2) project, this folder, shared through git  3) local, this folder only: '));
      if (scope) break;
      out('Not a valid choice. Use 1, 2, 3, or the scope name.');
    }
  }

  let projectDir = given.projectDir;
  if (scope !== 'global' && projectDir === undefined) {
    const answer = (await ask(`Folder [${ctx.projectDir}]: `)).trim();
    projectDir = answer === '' ? ctx.projectDir : answer;
  }
  return { agents, scope, projectDir };
};

// The command a person would type to do the same thing next time. Shown before anything is written.
export const commandLine = (answers: { agents: string[]; scope: AgentScope; projectDir?: string }): string => {
  const agents = answers.agents.join(' ');
  const folder = answers.scope !== 'global' && answers.projectDir ? ` --project-dir "${answers.projectDir}"` : '';
  return `multi-account-netlify-mcp install ${agents} --scope ${answers.scope}${folder}`;
};

export const formatSteps = (steps: Step[]): string[] =>
  steps.map((item) => `${item.status.padEnd(8)} ${item.agent.padEnd(12)} ${item.action}: ${item.detail}`);

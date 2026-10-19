import { copyFile, mkdir, rm, rmdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

// The account-routing skill. Codex and Antigravity read the same SKILL.md format as Claude Code, so the
// one file in the package is copied as it is.
export const SKILL_NAME = 'netlify-accounts';

export const skillSource = (packageRoot: string): string =>
  path.join(packageRoot, 'plugins', 'multi-account-netlify', 'skills', SKILL_NAME, 'SKILL.md');

// Copies the skill into <skillsRoot>/netlify-accounts/SKILL.md. Returns that folder.
export const installSkill = async (packageRoot: string, skillsRoot: string): Promise<string> => {
  const folder = path.join(skillsRoot, SKILL_NAME);
  await mkdir(folder, { recursive: true });
  await copyFile(skillSource(packageRoot), path.join(folder, 'SKILL.md'));
  return folder;
};

export const skillInstalled = (skillsRoot: string): boolean => existsSync(path.join(skillsRoot, SKILL_NAME, 'SKILL.md'));

// Removes the skill folder. Callers only do this for a folder the install recorded as its own.
export const removeSkill = async (skillsRoot: string): Promise<void> => {
  await rm(path.join(skillsRoot, SKILL_NAME), { recursive: true, force: true });
};

// Removes the given folders when they are empty, deepest first. An install that created the parent
// folders leaves nothing behind, and a folder that holds anything else is kept.
export const pruneEmpty = async (folders: string[]): Promise<void> => {
  for (const folder of folders) {
    await rmdir(folder).catch(() => undefined);
  }
};

// How a call may spread across accounts, decided per Netlify operation.
//   all:    every named account answers, and every answer is shown. For reads that need no id.
//   locate: every named account is asked, and only the accounts that own the id answer.
//           Accounts that do not own it are dropped from the result.
//   one:    exactly one account. Lists and "all" are refused. Used for every write.
// An operation that is not in this table is "one" until someone classifies it. The integration test
// fails when the official server adds or removes an operation, so the table cannot drift silently.
export type Mode = 'all' | 'locate' | 'one';

export const OPERATION_MODES: Readonly<Record<string, Mode>> = {
  // Reads with no id: every account can answer.
  'get-user': 'all',
  'get-teams': 'all',
  'get-projects': 'all',
  'get-extensions': 'all',
  'initialize-database': 'all',

  // Reads that need an id. Only the owning account answers.
  'get-deploy': 'locate',
  'get-deploy-for-site': 'locate',
  'get-team': 'locate',
  'get-team-env-vars': 'locate',
  'get-project': 'locate',
  'get-forms-for-project': 'locate',
  'get-full-extension-details': 'locate',
  'get-counts': 'locate',
  'get-topk': 'locate',
  'get-timeseries': 'locate',
  'get-request-logs': 'locate',
  'get-request-detail': 'locate',

  // Writes: one account only.
  'deploy-site': 'one',
  'create-new-project': 'one',
  'update-project-name': 'one',
  'update-forms': 'one',
  'update-visitor-access-controls': 'one',
  'change-extension-installation': 'one',
};

// Operations that both read and write. The mode depends on the parameters, so a read stays a read
// and a write stays on one account.
export const MIXED_OPERATIONS: ReadonlySet<string> = new Set(['manage-env-vars', 'manage-form-submissions']);

// The mode for one call. `params` are the operation's own parameters, as passed in selectSchema.params.
export const modeFor = (operation: string | undefined, params: Record<string, unknown> = {}): Mode => {
  if (!operation) {
    return 'one';
  }
  if (operation === 'manage-env-vars') {
    const writes = Boolean(params.upsertEnvVar) || Boolean(params.deleteEnvVar);
    return !writes && Boolean(params.getAllEnvVars) ? 'locate' : 'one';
  }
  if (operation === 'manage-form-submissions') {
    return params.action === 'get-submissions' ? 'locate' : 'one';
  }
  return OPERATION_MODES[operation] ?? 'one';
};

// Reads the operation name and its parameters from a grouped selector tool's arguments.
export const selectionOf = (args: Record<string, unknown>): { operation?: string; params: Record<string, unknown> } => {
  const selector = args.selectSchema as { operation?: unknown; params?: unknown } | undefined;
  const operation = typeof selector?.operation === 'string' ? selector.operation : undefined;
  const params = selector?.params && typeof selector.params === 'object' ? (selector.params as Record<string, unknown>) : {};
  return { operation, params };
};

// Text that means "this account does not have that id". Used only for locate mode.
const NOT_FOUND = /\b404\b|not found|do not exist|does not exist/i;

export const looksNotFound = (text: string): boolean => NOT_FOUND.test(text);

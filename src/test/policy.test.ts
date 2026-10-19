import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { looksNotFound, modeFor, selectionOf } from '../mux/policy.js';

describe('modeFor', () => {
  it('lets reads with no id run on every account', () => {
    for (const operation of ['get-user', 'get-teams', 'get-projects', 'get-extensions']) {
      assert.equal(modeFor(operation), 'all', operation);
    }
  });

  it('locates reads that need an id', () => {
    for (const operation of ['get-project', 'get-deploy', 'get-team-env-vars', 'get-counts', 'get-request-logs']) {
      assert.equal(modeFor(operation), 'locate', operation);
    }
  });

  it('keeps every write on one account', () => {
    for (const operation of ['deploy-site', 'create-new-project', 'update-forms', 'change-extension-installation']) {
      assert.equal(modeFor(operation), 'one', operation);
    }
  });

  it('decides the mixed env-var operation by its parameters', () => {
    assert.equal(modeFor('manage-env-vars', { getAllEnvVars: true }), 'locate');
    assert.equal(modeFor('manage-env-vars', { getAllEnvVars: true, upsertEnvVar: true }), 'one');
    assert.equal(modeFor('manage-env-vars', { deleteEnvVar: 'KEY' }), 'one');
    assert.equal(modeFor('manage-env-vars', {}), 'one');
  });

  it('decides the mixed form-submissions operation by its action', () => {
    assert.equal(modeFor('manage-form-submissions', { action: 'get-submissions' }), 'locate');
    assert.equal(modeFor('manage-form-submissions', { action: 'delete-submission' }), 'one');
    assert.equal(modeFor('manage-form-submissions', {}), 'one');
  });

  it('treats an unknown or missing operation as one account', () => {
    assert.equal(modeFor('some-future-operation'), 'one');
    assert.equal(modeFor(undefined), 'one');
  });
});

describe('selectionOf', () => {
  it('reads the operation and its params from a grouped selector', () => {
    assert.deepEqual(selectionOf({ selectSchema: { operation: 'get-project', params: { siteId: 'abc' } } }), {
      operation: 'get-project',
      params: { siteId: 'abc' },
    });
  });

  it('returns no operation when the selector is missing', () => {
    assert.deepEqual(selectionOf({}), { operation: undefined, params: {} });
  });
});

describe('looksNotFound', () => {
  it('recognises a 404 and the plain "do not exist" wording', () => {
    assert.equal(looksNotFound('Failed to fetch API: 404'), true);
    assert.equal(looksNotFound('This site id and the team it belongs to do not exist.'), true);
  });

  it('does not mistake ordinary errors for a miss', () => {
    assert.equal(looksNotFound('Netlify rejected this token (HTTP 401).'), false);
    assert.equal(looksNotFound('Failed to fetch API: 503'), false);
  });
});

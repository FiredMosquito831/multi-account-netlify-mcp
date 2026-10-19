import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// dist/version.js sits one level below the package root, where package.json lives.
export const VERSION: string = (require('../package.json') as { version: string }).version;

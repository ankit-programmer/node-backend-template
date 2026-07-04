// Skip husky in production installs, CI, and Docker builds (no .git in the build context).
import { existsSync } from 'node:fs';

if (process.env.NODE_ENV === 'production' || process.env.CI || !existsSync('.git')) {
    process.exit(0);
}
const { default: husky } = await import('husky');
const output = husky();
if (output) process.stdout.write(`${output}\n`);

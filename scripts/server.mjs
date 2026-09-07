// Entry point kept for `node scripts/wiki.mjs serve` and scripts/start.ps1.
// The HTTP application lives in scripts/server/.
import { listen } from './server/app.mjs';

listen();

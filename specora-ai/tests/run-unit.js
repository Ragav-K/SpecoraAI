/**
 * Runs every suite in tests/unit and exits non-zero if any of them fails.
 *
 * These suites need no database, no network and no API keys — they stub the
 * model and service layers — so they are safe to run anywhere, including CI.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const UNIT_DIR = path.join(__dirname, 'unit');
const suites = fs
  .readdirSync(UNIT_DIR)
  .filter((f) => f.endsWith('.test.js'))
  .sort();

let failed = 0;

for (const suite of suites) {
  console.log(`\n──── ${suite} ────`);
  const result = spawnSync(process.execPath, [path.join(UNIT_DIR, suite)], {
    stdio: 'inherit',
  });
  if (result.status !== 0) failed++;
}

console.log(
  failed
    ? `\n${failed} of ${suites.length} unit suite(s) FAILED\n`
    : `\n${suites.length} unit suite(s) passed\n`
);
process.exit(failed ? 1 : 0);

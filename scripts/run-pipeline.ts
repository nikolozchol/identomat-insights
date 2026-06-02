import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { runDailyPipeline } from '../src/lib/pipeline';

async function main() {
  console.log('Running daily pipeline (sync \u2192 detect \u2192 narrate \u2192 summarize)...\n');
  const r = await runDailyPipeline({});
  for (const s of r.steps) {
    console.log(`  ${s.ok ? 'OK ' : 'ERR'}  ${s.step.padEnd(16)} ${(s.ms + 'ms').padStart(8)}  ${s.detail}`);
  }
  console.log(`\n${r.ok ? 'OK' : 'COMPLETED WITH ERRORS'} \u00b7 window ${r.window.start}..${r.window.end} \u00b7 ${Math.round(r.totalMs / 1000)}s total.`);
  if (!r.ok) process.exitCode = 1;
}

main();

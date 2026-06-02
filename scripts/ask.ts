import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { askQuestion } from '../src/lib/ask';

async function main() {
  const question = process.argv.slice(2).join(' ').trim();
  if (!question) {
    console.log('Usage: npx tsx scripts/ask.ts "your question"');
    console.log('Examples:');
    console.log('  npx tsx scripts/ask.ts "what\'s going on with /pricing?"');
    console.log('  npx tsx scripts/ask.ts "where should I focus?"');
    console.log('  npx tsx scripts/ask.ts "how is /blog/identity-verification doing?"');
    console.log('  npx tsx scripts/ask.ts "how am I ranking for kyc api?"');
    process.exit(1);
  }

  const r = await askQuestion({ question });

  console.log(`\nQ: ${question}`);
  console.log(`intent: ${r.intent} · confidence: ${r.confidence}${r.dateRange ? ` · window ${r.dateRange.start}..${r.dateRange.end}` : ''}\n`);
  console.log(r.answer);
  if (r.actionSuggestions.length) {
    console.log(`\nCould become actions (${r.actionSuggestions.length}):`);
    for (const s of r.actionSuggestions) console.log(`  • [${s.severity}/${s.polarity}] ${s.title}`);
  }
}

main();

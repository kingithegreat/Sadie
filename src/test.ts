import { ToolRegistry } from './toolRegistry';
// Standalone ToolRegistry smoke-test — run with: npx ts-node src/test.ts
import fs from 'fs';
import path from 'path';

async function main() {
  const registry = new ToolRegistry(['calculator']);

  registry.register({
    name: 'calculator',
    description: 'Adds two numbers',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'number' },
        b: { type: 'number' }
      },
      required: ['a', 'b']
    },
    execute: async (input: { a: number; b: number }) => ({ sum: input.a + input.b })
  });

  const logPath = path.resolve(__dirname, 'execution.log.jsonl');
  if (fs.existsSync(logPath)) {
    fs.unlinkSync(logPath);
  }

  const result1 = await registry.execute('calculator', { a: 1, b: 2 });
  const result2 = await registry.execute('calculator', { a: 10, b: 5 });

  console.log('Result 1:', JSON.stringify(result1, null, 2));
  console.log('Result 2:', JSON.stringify(result2, null, 2));

  fs.appendFileSync(logPath, JSON.stringify(result1) + '\n');
  fs.appendFileSync(logPath, JSON.stringify(result2) + '\n');

  const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
  const entries = lines.map(l => JSON.parse(l));
  console.log('Chain valid (from file):', registry.verifyChain(entries));

  entries[0].outputHash = 'tampered';
  console.log('Chain valid after tamper:', registry.verifyChain(entries));
}

main().catch(console.error);

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
test('overlapping scheduler ticks do not double-process and lock releases after error', async () => {
  const source = fs.readFileSync(require.resolve('./server'), 'utf8');
  const code = source.slice(source.indexOf('let schedulerRunning = false'), source.indexOf('setInterval(runScheduler'));
  let reads = 0, release;
  const context = vm.createContext({
    pool: { query: async () => { reads++; await new Promise(resolve => { release = resolve; }); throw new Error('database unavailable'); } },
    console: { log() {}, error() {} }
  });
  vm.runInContext(code, context);
  const first = vm.runInContext('runScheduler()', context);
  await vm.runInContext('runScheduler()', context);
  assert.equal(reads, 1);
  release();
  await first;
  const next = vm.runInContext('runScheduler()', context);
  assert.equal(reads, 2);
  release();
  await next;
});

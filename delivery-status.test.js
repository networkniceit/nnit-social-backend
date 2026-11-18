const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const deliveryStatus = require('./delivery-status');

for (const [name, results, status] of [
  ['TikTok skipped', { tiktok: { success: false, skipped: true } }, 'failed'],
  ['platform rejected', { facebook: { success: false } }, 'failed'],
  ['no destinations', {}, 'failed'],
  ['Facebook delivered', { facebook: { success: true } }, 'published'],
  ['mixed delivery', { facebook: { success: true }, tiktok: { success: false, skipped: true } }, 'partial']
]) {
  test(name, async () => {
    assert.equal(deliveryStatus(results).status, status);
    // Exercise the actual scheduler without network access or a running server.
    const source = fs.readFileSync(require.resolve('./server'), 'utf8');
    const scheduler = source.slice(source.indexOf('let schedulerRunning = false'), source.indexOf('setInterval(runScheduler'));
    let saved;
    const pool = { query: async (sql, args) => {
      if (sql.startsWith('SELECT * FROM posts')) return { rows: [{ id: 1, client_id: 4, platforms: Object.keys(results) }] };
      if (sql.startsWith('SELECT * FROM social_accounts')) return { rows: [{}] };
      saved = args;
      return { rows: [] };
    } };
    const platformPublishers = Object.fromEntries(Object.entries(results).map(([key, result]) => [key, async () => result]));
    await vm.runInNewContext(scheduler + '\nrunScheduler();', { pool, platformPublishers, deliveryStatus, console: { log() {}, error(message) { throw new Error(message); } } });
    assert.equal(saved[0], status);
    assert.equal(saved[2] !== null, status !== 'failed');
    assert.deepEqual(JSON.parse(saved[1]), results);
  });
}

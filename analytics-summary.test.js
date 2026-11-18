const { test } = require('node:test');
const assert = require('node:assert/strict');
const summarize = require('./analytics-summary');
const fs = require('node:fs');
const vm = require('node:vm');

test('empty history does not invent metrics or deliveries', () => {
  const data = summarize([]);
  assert.equal(data.overview.totalPosts, 0);
  assert.equal(data.overview.totalFollowers, null);
  assert.equal(data.overview.totalEngagement, null);
  assert.equal(data.overview.avgEngagementRate, null);
  assert.deepEqual(data.platforms, {});
  assert.deepEqual(data.recentPublishedPosts, []);
});

test('counts full history and only confirmed platforms, orders by actual publication', () => {
  const posts = Array.from({ length: 12 }, (_, id) => ({ id, content: 'Post',
    published_at: `2026-11-${String(id + 1).padStart(2, '0')}T12:00:00Z`,
    results: { facebook: { success: true }, tiktok: { success: false, skipped: true } }
  }));
  posts[0].results = JSON.stringify(posts[0].results);
  posts.push({ id: 99, status: 'published', results: { tiktok: { skipped: true } } });
  const data = summarize(posts);
  assert.equal(data.overview.totalPosts, 13);
  assert.deepEqual(data.platforms, { facebook: 12 });
  assert.deepEqual(data.recentPublishedPosts.map(p => p.id), [11, 10, 9]);
  assert.deepEqual(data.recentPublishedPosts[0].platforms, ['facebook']);
});

test('database failure returns an error instead of empty successful analytics', async () => {
  const source = fs.readFileSync(require.resolve('./server'), 'utf8');
  const start = source.indexOf("app.get('/api/analytics/:clientId',");
  const end = source.indexOf("app.get('/api/analytics/:clientId/engagement'", start);
  let handler;
  vm.runInNewContext(source.slice(start, end), {
    app: { get: (_, fn) => { handler = fn; } },
    pool: { query: async () => { throw new Error('database unavailable'); } }, require
  });
  let status, body;
  const res = { status(code) { status = code; return this; }, json(value) { body = value; } };
  await handler({ params: { clientId: 4 } }, res);
  assert.equal(status, 500);
  assert.equal(body.error, 'database unavailable');
});

const fs = require('fs');
const p = 'C:/NNIT-Enterprise/social-automation/backend/server.js';
let c = fs.readFileSync(p, 'utf8');

if (c.includes("posts/scheduled/:clientId")) {
  console.log('Route already exists');
  process.exit(0);
}

const routes = `
app.get('/api/posts/scheduled/:clientId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM posts WHERE client_id=$1 ORDER BY created_at DESC',
      [req.params.clientId]
    );
    res.json({ success: true, posts: result.rows });
  } catch (err) {
    console.error('scheduled posts error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/posts/schedule', async (req, res) => {
  try {
    const { clientId, content, platforms, scheduledTime, media, hashtags } = req.body;
    const result = await pool.query(
      'INSERT INTO posts (client_id, content, platforms, scheduled_time, media, hashtags, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING *',
      [clientId, content, JSON.stringify(platforms||[]), scheduledTime||null, JSON.stringify(media||[]), JSON.stringify(hashtags||[]), 'scheduled']
    );
    res.json({ success: true, post: result.rows[0] });
  } catch (err) {
    console.error('schedule post error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
`;

c = c.replace('// START SERVER', routes + '\n// START SERVER');
fs.writeFileSync(p, c, 'utf8');
console.log('Done!');
console.log('scheduled route added:', c.includes('posts/scheduled/:clientId'));
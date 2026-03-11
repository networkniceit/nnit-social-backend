// ================================================================
// AI ROUTES
// ================================================================
app.post('/api/ai/content-ideas', async (req, res) => {
  try {
    const { industry, audience, count = 10 } = req.body;
    const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [{ role: 'user', content: `Generate ${count} unique social media content ideas for a ${industry} business targeting ${audience}. Vary between tips, questions, stories, promotions. Return ONLY a JSON array of strings, no markdown.` }],
      max_tokens: 1000, temperature: 0.95
    }, { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' } });
    const text = response.data.choices[0].message.content.trim().replace(/```json|```/g, '').trim();
    res.json({ success: true, ideas: JSON.parse(text) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/ai/generate-reply', async (req, res) => {
  try {
    const { comment, postContent, sentiment } = req.body;
    const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [{ role: 'user', content: `Write a professional reply to this ${sentiment} comment.\nPost: "${postContent}"\nComment: "${comment}"\nReply text only.` }],
      max_tokens: 200, temperature: 0.8
    }, { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' } });
    res.json({ success: true, reply: response.data.choices[0].message.content.trim() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/insights/:clientId/best-times', async (req, res) => {
  try {
    const clientRow = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.clientId]);
    const industry = clientRow.rows[0]?.industry || 'general';
    const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [{ role: 'user', content: `Suggest 5 best times to post on social media for a ${industry} business. Return ONLY a JSON array with objects: day, time, reason. No markdown.` }],
      max_tokens: 500, temperature: 0.7
    }, { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' } });
    const text = response.data.choices[0].message.content.trim().replace(/```json|```/g, '').trim();
    res.json({ success: true, recommendations: JSON.parse(text) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
// ANALYTICS ROUTES
// ================================================================
app.get('/api/analytics/:clientId', async (req, res) => {
  try {
    const postsResult = await pool.query('SELECT * FROM posts WHERE client_id = $1 ORDER BY created_at DESC LIMIT 10', [req.params.clientId]).catch(() => ({ rows: [] }));
    const totalPosts = postsResult.rows.length;
    res.json({ success: true, analytics: {
      overview: { totalPosts, totalEngagement: Math.floor(Math.random()*5000)+500, totalFollowers: Math.floor(Math.random()*10000)+1000, avgEngagementRate: parseFloat((Math.random()*5+1).toFixed(2)) },
      platforms: { facebook: Math.ceil(totalPosts*0.3)||1, instagram: Math.ceil(totalPosts*0.3)||1, linkedin: Math.ceil(totalPosts*0.2)||1, twitter: Math.ceil(totalPosts*0.2)||1 },
      topPerformingPosts: postsResult.rows.slice(0,3).map(p => ({ id: p.id, content: (p.content||'Post').substring(0,100), publishedAt: p.created_at, platforms: ['facebook','instagram'] }))
    }});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/analytics/:clientId/engagement', async (req, res) => {
  res.json({ success: true, engagement: { likes: Math.floor(Math.random()*2000)+200, comments: Math.floor(Math.random()*500)+50, shares: Math.floor(Math.random()*300)+30, clicks: Math.floor(Math.random()*1000)+100, impressions: Math.floor(Math.random()*20000)+2000 } });
});

app.get('/api/analytics/:clientId/growth', async (req, res) => {
  res.json({ success: true, growth: {
    followers: { current: Math.floor(Math.random()*10000)+1000, change: Math.floor(Math.random()*200)+10, changePercent: parseFloat((Math.random()*5+0.5).toFixed(1)) },
    engagement: { current: Math.floor(Math.random()*5000)+500, change: Math.floor(Math.random()*100)+5, changePercent: parseFloat((Math.random()*4+0.3).toFixed(1)) },
    reach: { current: Math.floor(Math.random()*30000)+3000, change: Math.floor(Math.random()*500)+50, changePercent: parseFloat((Math.random()*6+0.5).toFixed(1)) }
  }});
});


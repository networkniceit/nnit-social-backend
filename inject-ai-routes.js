const fs = require('fs');
const p = 'C:/NNIT-Enterprise/social-automation/backend/server.js';
let c = fs.readFileSync(p, 'utf8');

if (c.includes('/api/ai/video-script')) {
  console.log('Routes already exist');
  process.exit(0);
}

const routes = `
app.post('/api/ai/video-script', async (req, res) => {
  try {
    const { topic = '', platform = 'instagram', duration = '30' } = req.body;
    const r = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [{ role: 'user', content: 'Write a ' + duration + '-second video script for ' + platform + ' about: "' + topic + '". Return ONLY a JSON object with fields: hook (string), sections (array of {title, content, visual}), cta (string). No markdown, no explanation.' }],
      max_tokens: 800, temperature: 0.85
    }, { headers: { Authorization: 'Bearer ' + process.env.GROQ_API_KEY, 'Content-Type': 'application/json' } });
    const text = r.data.choices[0].message.content.trim().replace(/\`\`\`json|\`\`\`/g, '').trim();
    try { res.json({ success: true, script: JSON.parse(text) }); } catch(e) { res.json({ success: true, script: { raw: text } }); }
  } catch (err) { console.error('video-script error:', err.response && err.response.data || err.message); res.status(500).json({ error: err.message }); }
});

app.post('/api/ai/photo-prompts', async (req, res) => {
  try {
    const { topic = '', style = 'modern', count = 4 } = req.body;
    const r = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [{ role: 'user', content: 'Generate ' + count + ' creative social media photo ideas for: "' + topic + '" in ' + style + ' style. Return ONLY a JSON array of objects with fields: title, description, caption. No markdown, no explanation.' }],
      max_tokens: 800, temperature: 0.9
    }, { headers: { Authorization: 'Bearer ' + process.env.GROQ_API_KEY, 'Content-Type': 'application/json' } });
    const text = r.data.choices[0].message.content.trim().replace(/\`\`\`json|\`\`\`/g, '').trim();
    const match = text.match(/\[\\s\\S]*\]/);
    res.json({ success: true, prompts: JSON.parse(match ? match[0] : text) });
  } catch (err) { console.error('photo-prompts error:', err.response && err.response.data || err.message); res.status(500).json({ error: err.message }); }
});
`;

c = c.replace('// START SERVER', routes + '\n// START SERVER');
fs.writeFileSync(p, c, 'utf8');
console.log('Done!');
console.log('video-script added:', c.includes('/api/ai/video-script'));
console.log('photo-prompts added:', c.includes('/api/ai/photo-prompts'));
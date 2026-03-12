const fs = require('fs');
const p = 'C:/NNIT-Enterprise/social-automation/backend/server.js';
let c = fs.readFileSync(p, 'utf8');

if (c.includes("put('/api/clients/:id'")) {
  console.log('Routes already exist');
  process.exit(0);
}

const routes = `
app.put('/api/clients/:id', async (req, res) => {
  try {
    const { name, email, phone, industry, website, notes, plan } = req.body;
    const result = await pool.query(
      'UPDATE clients SET name=$1, email=$2, phone=$3, industry=$4, website=$5, notes=$6, updated_at=NOW() WHERE id=$7 RETURNING *',
      [name, email, phone||null, industry||null, website||null, notes||null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    res.json({ success: true, client: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/clients/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM clients WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
`;

c = c.replace('// START SERVER', routes + '\n// START SERVER');
fs.writeFileSync(p, c, 'utf8');
console.log('Done!');
console.log('PUT added:', c.includes("put('/api/clients/:id'"));
console.log('DELETE added:', c.includes("delete('/api/clients/:id'"));
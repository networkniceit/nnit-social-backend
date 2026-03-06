require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.query(`
  SELECT table_name, column_name, data_type 
  FROM information_schema.columns 
  WHERE table_schema='public' 
  ORDER BY table_name, ordinal_position
`).then(r => {
  r.rows.forEach(row => console.log(row.table_name, '|', row.column_name, '|', row.data_type));
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
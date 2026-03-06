require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.query(`SELECT platform, user_id, 
  LEFT(access_token, 30) as token_preview,
  page_id, page_access_token IS NOT NULL as has_page_token,
  LEFT(page_access_token, 30) as page_token_preview,
  instagram_account_id, account_id, username
  FROM social_accounts ORDER BY platform`)
  .then(r => { r.rows.forEach(row => console.log(JSON.stringify(row, null, 2))); process.exit(0); })
  .catch(e => { console.error(e.message); process.exit(1); });
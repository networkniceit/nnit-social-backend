const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:iBiHLxnIhzZhmguJPIkmPqlkfCzaDrNt@nozomi.proxy.rlwy.net:21286/railway',
  ssl: { rejectUnauthorized: false }
});

async function fix() {
  const queries = [
    `ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS page_name VARCHAR(255)`,
    `ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS page_id VARCHAR(255)`,
    `ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS page_access_token TEXT`,
    `ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS account_id VARCHAR(255)`,
    `ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS username VARCHAR(255)`,
    `ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS profile_picture_url TEXT`,
    `ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS scope TEXT`,
    `ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS refresh_token TEXT`,
    `ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMP`,
    `ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`,
    `DO $$
     BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint
         WHERE conname = 'social_accounts_user_id_platform_key'
       ) THEN
         ALTER TABLE social_accounts ADD CONSTRAINT social_accounts_user_id_platform_key UNIQUE (user_id, platform);
       END IF;
     END
     $$;`
  ];

  for (const q of queries) {
    try {
      await pool.query(q);
      console.log('✅ Done:', q.substring(0, 60));
    } catch (err) {
      console.error('❌ Error:', err.message);
    }
  }

  await pool.end();
  console.log('All done!');
}

fix();
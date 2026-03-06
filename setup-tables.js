require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.query(`
  CREATE TABLE IF NOT EXISTS social_connections (
    id SERIAL PRIMARY KEY,
    user_id INTEGER DEFAULT 1,
    platform VARCHAR(50) NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    extra_data JSONB DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'connected',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS posts (
    id SERIAL PRIMARY KEY,
    client_id VARCHAR(100),
    content TEXT,
    platforms JSONB DEFAULT '[]',
    scheduled_time TIMESTAMP,
    media JSONB DEFAULT '[]',
    hashtags JSONB DEFAULT '[]',
    status VARCHAR(20) DEFAULT 'scheduled',
    results JSONB DEFAULT '{}',
    published_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
  );
`).then(() => {
  console.log('Tables created!');
  process.exit(0);
}).catch(e => {
  console.error(e.message);
  process.exit(1);
});
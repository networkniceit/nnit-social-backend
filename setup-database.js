require('dotenv').config();
const { Client } = require('pg');

async function setupDatabase() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: false
  });

  try {
    await client.connect();
    console.log('Connected to database');

    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS social_accounts (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        platform VARCHAR(50) NOT NULL,
        access_token TEXT NOT NULL,
        instagram_account_id VARCHAR(255),
        instagram_account_name VARCHAR(255),
        page_id VARCHAR(255),
        page_access_token TEXT,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_user_platform ON social_accounts(user_id, platform);
    `;

    await client.query(createTableQuery);
    console.log('✓ Table created successfully');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

setupDatabase();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:iBiHLxnIhzZhmguJPIkmPqlkfCzaDrNt@nozomi.proxy.rlwy.net:21286/railway'
});

async function setup() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(100),
        industry VARCHAR(255),
        website VARCHAR(255),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ clients table created');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'client',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ users table created');

    // Insert NNIT as default client
    await pool.query(`
      INSERT INTO clients (name, email, industry, website, notes)
      VALUES ('NNIT Enterprise', 'networkniceit@gmail.com', 'Information Technology', 'https://nnit-social-frontend-kedc.vercel.app', 'Main NNIT account')
      ON CONFLICT DO NOTHING
    `);
    console.log('✅ Default NNIT client added');

    const result = await pool.query('SELECT * FROM clients');
    console.log('Clients in database:', result.rows);

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    pool.end();
  }
}

setup();
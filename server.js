require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { OpenAI } = require('openai');
const Groq = require('groq-sdk');
const axios = require('axios');
const { Pool } = require('pg');
const postRoutes = require('./routes/postRoutes');
const uploadRoutes = require('./routes/uploadRoutes');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/api', postRoutes);
app.use('/api/upload', uploadRoutes);

// ================================================================
// DATABASE CONNECTION
// ================================================================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ================================================================
// AI ENGINES
// ================================================================

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY?.trim() });

// ================================================================
// IN-MEMORY DATA STORES
// ================================================================

const clients = new Map();
const scheduledPosts = [];
const publishedPosts = [];
const autoReplies = [];
const analytics = new Map();

// ================================================================
// SHARED HELPER — ensure social_accounts table exists
// ================================================================

async function ensureSocialAccountsTable() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS social_accounts (
        id                     SERIAL PRIMARY KEY,
        user_id                INTEGER NOT NULL,
        platform               VARCHAR(50) NOT NULL,
        access_token           TEXT,
        account_id             VARCHAR(255),
        account_name           VARCHAR(255),
        username               VARCHAR(255),
        page_id                VARCHAR(255),
        page_name              VARCHAR(255),
        page_access_token      TEXT,
        instagram_account_id   VARCHAR(100),
        instagram_account_name VARCHAR(100),
        profile_picture_url    TEXT,
        scope                  TEXT,
        refresh_token          TEXT,
        token_expires_at       TIMESTAMP,
        created_at             TIMESTAMP DEFAULT NOW(),
        updated_at             TIMESTAMP DEFAULT NOW()
      )
    `);

    const alterQueries = [
      `ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS page_name VARCHAR(255)`,
      `ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS page_id VARCHAR(255)`,
      `ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS page_access_token TEXT`,
      `ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS account_id VARCHAR(255)`,
      `ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS account_name VARCHAR(255)`,
      `ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS username VARCHAR(255)`,
      `ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS instagram_account_id VARCHAR(100)`,
      `ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS instagram_account_name VARCHAR(100)`,
      `ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS profile_picture_url TEXT`,
      `ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS scope TEXT`,
      `ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS refresh_token TEXT`,
      `ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMP`,
      `ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`
    ];

    for (const query of alterQueries) {
      await client.query(query);
    }

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'social_accounts_user_id_platform_key'
        ) THEN
          ALTER TABLE social_accounts ADD CONSTRAINT social_accounts_user_id_platform_key UNIQUE (user_id, platform);
        END IF;
      END
      $$;
    `);

    console.log('social_accounts table verified/migrated');
  } catch (err) {
    console.error('ensureSocialAccountsTable error:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// ================================================================
// CLIENT MANAGEMENT ROUTES
// ================================================================

app.post('/api/clients', async (req, res) => {
  try {
    const { name, email, industry, brandVoice, platforms, plan, phone, website, notes } = req.body;
    const result = await pool.query(
      `INSERT INTO clients (name, email, phone, industry, website, notes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW()) RETURNING *`,
      [name, email, phone || null, industry, website || null, notes || brandVoice || null]
    );
    res.json({ success: true, client: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/clients', async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM clients ORDER BY created_at DESC`);
    res.json({ success: true, clients: result.rows, total: result.rows.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/clients/:clientId', async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM clients WHERE id = $1`, [req.params.clientId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    res.json({ success: true, client: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/clients/:clientId', async (req, res) => {
  try {
    const { name, email, phone, industry, website, notes } = req.body;
    const result = await pool.query(
      `UPDATE clients SET name=$1, email=$2, phone=$3, industry=$4, website=$5, notes=$6, updated_at=NOW()
       WHERE id=$7 RETURNING *`,
      [name, email, phone, industry, website, notes, req.params.clientId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    res.json({ success: true, client: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/clients/:clientId', async (req, res) => {
  try {
    await pool.query(`DELETE FROM clients WHERE id = $1`, [req.params.clientId]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================================================================
// SOCIAL PLATFORM CLIENT-LEVEL CONNECTION ROUTES
// ================================================================

app.post('/api/clients/:clientId/connect/facebook', (req, res) => {
  const { accessToken, pageId, pageName } = req.body;
  const client = clients.get(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  client.socialAccounts = client.socialAccounts || {};
  client.socialAccounts.facebook = { connected: true, accessToken, pageId, pageName, connectedAt: new Date().toISOString() };
  res.json({ success: true, message: 'Facebook connected' });
});

app.post('/api/clients/:clientId/connect/instagram', (req, res) => {
  const { accessToken, accountId, username } = req.body;
  const client = clients.get(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  client.socialAccounts = client.socialAccounts || {};
  client.socialAccounts.instagram = { connected: true, accessToken, accountId, username, connectedAt: new Date().toISOString() };
  res.json({ success: true, message: 'Instagram connected' });
});

app.post('/api/clients/:clientId/connect/twitter', (req, res) => {
  const { accessToken, accessSecret, username } = req.body;
  const client = clients.get(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  client.socialAccounts = client.socialAccounts || {};
  client.socialAccounts.twitter = { connected: true, accessToken, accessSecret, username, connectedAt: new Date().toISOString() };
  res.json({ success: true, message: 'Twitter connected' });
});

app.post('/api/clients/:clientId/connect/linkedin', (req, res) => {
  const { accessToken, personId, companyId, name } = req.body;
  const client = clients.get(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  client.socialAccounts = client.socialAccounts || {};
  client.socialAccounts.linkedin = { connected: true, accessToken, personId, companyId, name, connectedAt: new Date().toISOString() };
  res.json({ success: true, message: 'LinkedIn connected' });
});

app.post('/api/clients/:clientId/connect/tiktok', (req, res) => {
  const { accessToken, openId, username } = req.body;
  const client = clients.get(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  client.socialAccounts = client.socialAccounts || {};
  client.socialAccounts.tiktok = { connected: true, accessToken, openId, username, connectedAt: new Date().toISOString() };
  res.json({ success: true, message: 'TikTok connected' });
});

app.get('/api/clients/:clientId/platforms', (req, res) => {
  const client = clients.get(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const platforms = Object.keys(client.socialAccounts || {}).map(platform => ({
    name: platform,
    connected: client.socialAccounts[platform].connected,
    connectedAt: client.socialAccounts[platform].connectedAt
  }));
  res.json({ success: true, platforms });
});

// ================================================================
// INSTAGRAM OAuth & INTEGRATION ROUTES
// ================================================================

app.get('/api/auth/instagram', (req, res) => {
  const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
  const REDIRECT_URI = `${process.env.BACKEND_URL}/api/auth/instagram/callback`;
  const authUrl =
    `https://www.facebook.com/v18.0/dialog/oauth?` +
    `client_id=${FACEBOOK_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=instagram_basic,instagram_manage_insights,pages_show_list,pages_read_engagement` +
    `&response_type=code`;
  res.redirect(authUrl);
});

app.get('/api/auth/instagram/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect(`${process.env.FRONTEND_URL}/settings?error=no_code`);

  try {
    const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
    const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
    const REDIRECT_URI = `${process.env.BACKEND_URL}/api/auth/instagram/callback`;

    const tokenResponse = await axios.get(
      `https://graph.facebook.com/v18.0/oauth/access_token?client_id=${FACEBOOK_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_secret=${FACEBOOK_APP_SECRET}&code=${code}`
    );
    const accessToken = tokenResponse.data.access_token;

    const pagesResponse = await axios.get(`https://graph.facebook.com/v18.0/me/accounts?access_token=${accessToken}`);
    if (!pagesResponse.data.data || pagesResponse.data.data.length === 0) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings?error=no_pages`);
    }

    const pageAccessToken = pagesResponse.data.data[0].access_token;
    const pageId = pagesResponse.data.data[0].id;

    const igAccountResponse = await axios.get(
      `https://graph.facebook.com/v18.0/${pageId}?fields=instagram_business_account&access_token=${pageAccessToken}`
    );
    if (!igAccountResponse.data.instagram_business_account) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings?error=no_instagram`);
    }

    const instagramAccountId = igAccountResponse.data.instagram_business_account.id;
    const usernameResponse = await axios.get(
      `https://graph.facebook.com/v18.0/${instagramAccountId}?fields=username&access_token=${pageAccessToken}`
    );
    const username = usernameResponse.data.username;

    await ensureSocialAccountsTable();

    try {
      await pool.query(`
        INSERT INTO social_accounts
          (user_id, platform, access_token, instagram_account_id, instagram_account_name, page_id, page_access_token)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (user_id, platform)
        DO UPDATE SET
          access_token           = $3,
          instagram_account_id   = $4,
          instagram_account_name = $5,
          page_id                = $6,
          page_access_token      = $7,
          updated_at             = CURRENT_TIMESTAMP
      `, [1, 'instagram', accessToken, instagramAccountId, username, pageId, pageAccessToken]);
    } catch (dbError) {
      console.error('DB save error in Instagram callback:', dbError.message);
    }

    res.redirect(
      `${process.env.FRONTEND_URL}/settings?instagram_connected=true&account_id=${instagramAccountId}&username=${encodeURIComponent(username)}&user_id=1`
    );
  } catch (error) {
    console.error('Instagram OAuth error:', error.response?.data || error.message);
    res.redirect(
      `${process.env.FRONTEND_URL}/settings?instagram_error=true&reason=${encodeURIComponent(error.response?.data?.error?.message || error.message)}`
    );
  }
});

app.post('/api/auth/instagram/deauthorize', (req, res) => {
  console.log('Instagram deauthorize callback received:', req.body);
  res.sendStatus(200);
});

app.post('/api/auth/instagram/delete', (req, res) => {
  const { signed_request } = req.body;
  console.log('Instagram data deletion request:', signed_request);
  res.json({ url: `${process.env.FRONTEND_URL}/data-deletion`, confirmation_code: `deletion_${Date.now()}` });
});

app.post('/api/auth/instagram/save', async (req, res) => {
  try {
    const { userId, accessToken, instagramAccountId, username, pageId, pageAccessToken } = req.body;
    const resolvedUserId = userId || 1;
    await ensureSocialAccountsTable();

    const result = await pool.query(`
      INSERT INTO social_accounts (user_id, platform, access_token, instagram_account_id, instagram_account_name, page_id, page_access_token)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (user_id, platform)
      DO UPDATE SET
        access_token           = $3,
        instagram_account_id   = $4,
        instagram_account_name = $5,
        page_id                = $6,
        page_access_token      = $7,
        updated_at             = CURRENT_TIMESTAMP
      RETURNING id, user_id, platform, instagram_account_id, instagram_account_name, page_id, updated_at
    `, [resolvedUserId, 'instagram', accessToken, instagramAccountId, username, pageId, pageAccessToken]);

    res.json({ success: true, account: result.rows[0] });
  } catch (error) {
    console.error('Error saving Instagram credentials:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/auth/instagram/load', async (req, res) => {
  try {
    const userId = req.query.userId || 1;
    await ensureSocialAccountsTable();

    const result = await pool.query(
      `SELECT id, user_id, platform, instagram_account_id, instagram_account_name, page_id, updated_at
       FROM social_accounts WHERE user_id = $1 AND platform = 'instagram'`,
      [userId]
    );

    if (result.rows.length > 0) {
      res.json({ success: true, account: result.rows[0] });
    } else {
      res.json({ success: false, account: null });
    }
  } catch (error) {
    console.error('Load error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/instagram/test', async (req, res) => {
  try {
    const { access_token, account_id } = req.query;
    const token = access_token || process.env.INSTAGRAM_ACCESS_TOKEN;
    const accountId = account_id || process.env.INSTAGRAM_ACCOUNT_ID;
    const response = await axios.get(
      `https://graph.facebook.com/v18.0/${accountId}?fields=name,username,profile_picture_url,followers_count,media_count&access_token=${token}`
    );
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/instagram/media', async (req, res) => {
  try {
    const { access_token, account_id } = req.query;
    const token = access_token || process.env.INSTAGRAM_ACCESS_TOKEN;
    const accountId = account_id || process.env.INSTAGRAM_ACCOUNT_ID;
    const response = await axios.get(
      `https://graph.facebook.com/v18.0/${accountId}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count&access_token=${token}`
    );
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================================================================
// FACEBOOK OAuth & INTEGRATION ROUTES
// ================================================================

app.get('/api/auth/facebook', (req, res) => {
  const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
  const REDIRECT_URI = `${process.env.BACKEND_URL}/api/auth/facebook/callback`;
  const authUrl =
    `https://www.facebook.com/v18.0/dialog/oauth?` +
    `client_id=${FACEBOOK_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=pages_show_list,pages_read_engagement,pages_manage_posts,pages_read_user_content,read_insights` +
    `&response_type=code`;
  res.redirect(authUrl);
});

app.get('/api/auth/facebook/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect(`${process.env.FRONTEND_URL}/settings?facebook_error=true&reason=no_code`);

  try {
    const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
    const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
    const REDIRECT_URI = `${process.env.BACKEND_URL}/api/auth/facebook/callback`;

    const tokenResponse = await axios.get(
      `https://graph.facebook.com/v18.0/oauth/access_token?client_id=${FACEBOOK_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_secret=${FACEBOOK_APP_SECRET}&code=${code}`
    );
    const userAccessToken = tokenResponse.data.access_token;

    let longLivedToken = userAccessToken;
    try {
      const longLivedResponse = await axios.get(
        `https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${FACEBOOK_APP_ID}&client_secret=${FACEBOOK_APP_SECRET}&fb_exchange_token=${userAccessToken}`
      );
      longLivedToken = longLivedResponse.data.access_token || userAccessToken;
    } catch (e) {
      console.error('Long-lived token exchange failed:', e.message);
    }

    const pagesResponse = await axios.get(`https://graph.facebook.com/v18.0/me/accounts?access_token=${userAccessToken}`);
    if (!pagesResponse.data.data || pagesResponse.data.data.length === 0) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings?facebook_error=true&reason=no_pages`);
    }

    const page = pagesResponse.data.data[0];
    const pageAccessToken = page.access_token;
    const pageId = page.id;
    const pageName = page.name;

    await ensureSocialAccountsTable();

    await pool.query(
      `INSERT INTO social_accounts (user_id, platform, access_token, instagram_account_name, page_id, page_access_token)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, platform)
       DO UPDATE SET
         access_token           = EXCLUDED.access_token,
         instagram_account_name = EXCLUDED.instagram_account_name,
         page_id                = EXCLUDED.page_id,
         page_access_token      = EXCLUDED.page_access_token,
         updated_at             = CURRENT_TIMESTAMP`,
      [1, 'facebook', longLivedToken, pageName, pageId, pageAccessToken]
    );

    res.redirect(
      `${process.env.FRONTEND_URL}/settings?facebook_connected=true&facebook_page_id=${encodeURIComponent(pageId)}&facebook_page_name=${encodeURIComponent(pageName)}`
    );
  } catch (error) {
    console.error('Facebook OAuth error:', error.response?.data || error.message);
    res.redirect(
      `${process.env.FRONTEND_URL}/settings?facebook_error=true&reason=${encodeURIComponent(error.response?.data?.error?.message || error.message)}`
    );
  }
});

app.get('/api/auth/facebook/load', async (req, res) => {
  try {
    await ensureSocialAccountsTable();
    const userId = req.query.userId || 1;

    const result = await pool.query(
      `SELECT id, user_id, platform, page_id, instagram_account_name, updated_at
       FROM social_accounts WHERE user_id = $1 AND platform = 'facebook' LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({ success: false, connected: false, message: 'Facebook account not connected' });
    }

    const account = result.rows[0];
    res.json({
      success: true, connected: true,
      account: { id: account.id, userId: account.user_id, platform: account.platform, pageId: account.page_id, pageName: account.instagram_account_name, updatedAt: account.updated_at }
    });
  } catch (err) {
    console.error('Facebook load error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/facebook/save', async (req, res) => {
  try {
    const { userId, pageId, pageName, pageAccessToken, accessToken } = req.body;
    const resolvedUserId = userId || 1;
    await ensureSocialAccountsTable();

    const result = await pool.query(`
      INSERT INTO social_accounts (user_id, platform, access_token, instagram_account_name, page_id, page_access_token)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id, platform)
      DO UPDATE SET
        access_token           = EXCLUDED.access_token,
        instagram_account_name = EXCLUDED.instagram_account_name,
        page_id                = EXCLUDED.page_id,
        page_access_token      = EXCLUDED.page_access_token,
        updated_at             = CURRENT_TIMESTAMP
      RETURNING id, user_id, platform, page_id, instagram_account_name, updated_at
    `, [resolvedUserId, 'facebook', accessToken, pageName, pageId, pageAccessToken]);

    res.json({ success: true, account: result.rows[0] });
  } catch (error) {
    console.error('Facebook save error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ FIXED - only this route was changed
app.post('/api/facebook/post', async (req, res) => {
  try {
    const { message, link, userId } = req.body;
    const resolvedUserId = userId || 1;

    const dbResult = await pool.query(
      `SELECT page_id, page_access_token FROM social_accounts WHERE user_id = $1 AND platform = 'facebook'`,
      [resolvedUserId]
    );
    if (dbResult.rows.length === 0)
      return res.status(400).json({ success: false, error: 'Facebook not connected' });

    const { page_id, page_access_token } = dbResult.rows[0];

    // Guard: catch missing/empty token early with clear message
    if (!page_access_token || page_access_token.trim() === '') {
      return res.status(401).json({
        success: false,
        error: 'Facebook access token missing. Please reconnect your Facebook account.'
      });
    }

    const postData = { message, access_token: page_access_token };
    if (link) postData.link = link;

    try {
      const response = await axios.post(
        `https://graph.facebook.com/v18.0/${page_id}/feed`,
        postData
      );
      return res.json({ success: true, postId: response.data.id });

    } catch (postError) {
      const fbError = postError.response?.data?.error;

      // Token expired or invalid — clear stale token and prompt reconnect
      if (fbError?.code === 190 || fbError?.code === 102 || fbError?.type === 'OAuthException') {
        await pool.query(
          `UPDATE social_accounts SET page_access_token = '', updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $1 AND platform = 'facebook'`,
          [resolvedUserId]
        );
        return res.status(401).json({
          success: false,
          error: 'Facebook token expired. Please reconnect your Facebook account.'
        });
      }

      throw postError;
    }

  } catch (error) {
    console.error('Facebook post error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.error?.message || error.message
    });
  }
});

app.post('/api/facebook/post/photo', async (req, res) => {
  try {
    const { caption, imageUrl, userId } = req.body;
    const resolvedUserId = userId || 1;
    const dbResult = await pool.query(
      `SELECT page_id, page_access_token FROM social_accounts WHERE user_id = $1 AND platform = 'facebook'`,
      [resolvedUserId]
    );
    if (dbResult.rows.length === 0) return res.status(400).json({ success: false, error: 'Facebook not connected' });

    const { page_id, page_access_token } = dbResult.rows[0];
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${page_id}/photos`,
      { caption, url: imageUrl, access_token: page_access_token }
    );
    res.json({ success: true, postId: response.data.id });
  } catch (error) {
    console.error('Facebook photo post error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message });
  }
});

app.get('/api/facebook/posts', async (req, res) => {
  try {
    const userId = req.query.userId || 1;
    const dbResult = await pool.query(
      `SELECT page_id, page_access_token FROM social_accounts WHERE user_id = $1 AND platform = 'facebook'`,
      [userId]
    );
    if (dbResult.rows.length === 0) return res.status(400).json({ success: false, error: 'Facebook not connected' });

    const { page_id, page_access_token } = dbResult.rows[0];
    const response = await axios.get(
      `https://graph.facebook.com/v18.0/${page_id}/feed?fields=id,message,created_time,likes.summary(true),comments.summary(true),shares&access_token=${page_access_token}`
    );
    res.json({ success: true, posts: response.data.data });
  } catch (error) {
    console.error('Facebook posts error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message });
  }
});

app.get('/api/facebook/analytics', async (req, res) => {
  try {
    const userId = req.query.userId || 1;
    const { metric = 'page_impressions,page_engaged_users,page_fans,page_views_total', period = 'day' } = req.query;

    const dbResult = await pool.query(
      `SELECT page_id, page_access_token, instagram_account_name AS page_name FROM social_accounts WHERE user_id = $1 AND platform = 'facebook'`,
      [userId]
    );
    if (dbResult.rows.length === 0) return res.status(400).json({ success: false, error: 'Facebook not connected' });

    const { page_id, page_access_token, page_name: pageName } = dbResult.rows[0];

    const insightsResponse = await axios.get(
      `https://graph.facebook.com/v18.0/${page_id}/insights?metric=${metric}&period=${period}&access_token=${page_access_token}`
    );
    const pageInfoResponse = await axios.get(
      `https://graph.facebook.com/v18.0/${page_id}?fields=fan_count,followers_count,name&access_token=${page_access_token}`
    );

    const insights = {};
    insightsResponse.data.data.forEach(item => { insights[item.name] = item.values; });

    res.json({
      success: true,
      pageName: pageInfoResponse.data.name || pageName,
      fanCount: pageInfoResponse.data.fan_count,
      followersCount: pageInfoResponse.data.followers_count,
      insights
    });
  } catch (error) {
    console.error('Facebook analytics error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message });
  }
});

app.get('/api/facebook/analytics/post/:postId', async (req, res) => {
  try {
    const userId = req.query.userId || 1;
    const dbResult = await pool.query(
      `SELECT page_access_token FROM social_accounts WHERE user_id = $1 AND platform = 'facebook'`,
      [userId]
    );
    if (dbResult.rows.length === 0) return res.status(400).json({ success: false, error: 'Facebook not connected' });

    const { page_access_token } = dbResult.rows[0];
    const { postId } = req.params;

    const response = await axios.get(
      `https://graph.facebook.com/v18.0/${postId}/insights?metric=post_impressions,post_engaged_users,post_reactions_by_type_total,post_clicks&access_token=${page_access_token}`
    );

    const insights = {};
    response.data.data.forEach(item => { insights[item.name] = item.values?.[0]?.value || 0; });

    res.json({ success: true, postId, insights });
  } catch (error) {
    console.error('Facebook post analytics error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message });
  }
});

app.delete('/api/auth/facebook/disconnect', async (req, res) => {
  try {
    const userId = req.query.userId || 1;
    await pool.query(`DELETE FROM social_accounts WHERE user_id = $1 AND platform = 'facebook'`, [userId]);
    res.json({ success: true, message: 'Facebook disconnected' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ================================================================
// TIKTOK OAuth & INTEGRATION ROUTES
// ================================================================
// ================================================================
// TIKTOK OAuth & INTEGRATION ROUTES
// ================================================================

app.get('/api/auth/tiktok', (req, res) => {
  const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
  const REDIRECT_URI = `${process.env.BACKEND_URL}/api/auth/tiktok/callback`;
  const csrfState = Math.random().toString(36).substring(2);
  const authUrl =
    `https://www.tiktok.com/v2/auth/authorize?` +
    `client_key=${TIKTOK_CLIENT_KEY}` +
    `&scope=user.info.basic,video.publish,video.upload` +  // ✅ FIXED: added required posting scopes
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&state=${csrfState}`;
  res.redirect(authUrl);
});

app.get('/api/auth/tiktok/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) {
    return res.redirect(`${process.env.FRONTEND_URL}/settings?tiktok_error=true&reason=${encodeURIComponent(error || 'no_code')}`);
  }

  try {
    const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
    const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
    const REDIRECT_URI = `${process.env.BACKEND_URL}/api/auth/tiktok/callback`;

    const tokenResponse = await axios.post(
      'https://open.tiktokapis.com/v2/oauth/token/',
      new URLSearchParams({ client_key: TIKTOK_CLIENT_KEY, client_secret: TIKTOK_CLIENT_SECRET, code, grant_type: 'authorization_code', redirect_uri: REDIRECT_URI }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(`${TIKTOK_CLIENT_KEY}:${TIKTOK_CLIENT_SECRET}`).toString('base64')}`
        }
      }
    );

    const { access_token, open_id, refresh_token } = tokenResponse.data;

    const userResponse = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
      headers: { 'Authorization': `Bearer ${access_token}` },
      params: { fields: 'open_id,union_id,avatar_url,display_name' }
    });

    const userInfo = userResponse.data.data.user;
    const displayName = userInfo.display_name || 'TikTok User';

    await ensureSocialAccountsTable();

    await pool.query(`
      INSERT INTO social_accounts
        (user_id, platform, access_token, instagram_account_id, instagram_account_name, page_id, page_access_token)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (user_id, platform)
      DO UPDATE SET
        access_token           = $3,
        instagram_account_id   = $4,
        instagram_account_name = $5,
        page_id                = $6,
        page_access_token      = $7,
        updated_at             = CURRENT_TIMESTAMP
    `, [1, 'tiktok', access_token, open_id, displayName, open_id, refresh_token]);

    res.redirect(
      `${process.env.FRONTEND_URL}/settings?tiktok_connected=true&tiktok_open_id=${open_id}&tiktok_username=${encodeURIComponent(displayName)}`
    );
  } catch (error) {
    console.error('TikTok OAuth error:', error.response?.data || error.message);
    res.redirect(`${process.env.FRONTEND_URL}/settings?tiktok_error=true&reason=${encodeURIComponent(error.response?.data?.message || error.message)}`);
  }
});

app.get('/api/auth/tiktok/load', async (req, res) => {
  try {
    const userId = req.query.userId || 1;
    await ensureSocialAccountsTable();

    const result = await pool.query(
      `SELECT id, user_id, platform, instagram_account_id, instagram_account_name, page_id, updated_at
       FROM social_accounts WHERE user_id = $1 AND platform = 'tiktok'`,
      [userId]
    );

    if (result.rows.length > 0) {
      res.json({ success: true, account: result.rows[0] });
    } else {
      res.json({ success: false, account: null });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/auth/tiktok/disconnect', async (req, res) => {
  try {
    const userId = req.query.userId || 1;
    await pool.query(`DELETE FROM social_accounts WHERE user_id = $1 AND platform = 'tiktok'`, [userId]);
    res.json({ success: true, message: 'TikTok disconnected' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ FIXED - token refresh + scope error handling added
app.post('/api/tiktok/post/video', async (req, res) => {
  try {
    const { videoUrl, caption, userId } = req.body;
    const resolvedUserId = userId || 1;

    const dbResult = await pool.query(
      `SELECT access_token, page_access_token FROM social_accounts WHERE user_id = $1 AND platform = 'tiktok'`,
      [resolvedUserId]
    );
    if (dbResult.rows.length === 0)
      return res.status(400).json({ success: false, error: 'TikTok not connected' });

    let { access_token, page_access_token: refresh_token } = dbResult.rows[0];

    // Helper to refresh TikTok access token
    const refreshAccessToken = async () => {
      const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
      const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;

      const response = await axios.post(
        'https://open.tiktokapis.com/v2/oauth/token/',
        new URLSearchParams({
          client_key: TIKTOK_CLIENT_KEY,
          client_secret: TIKTOK_CLIENT_SECRET,
          grant_type: 'refresh_token',
          refresh_token
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${Buffer.from(`${TIKTOK_CLIENT_KEY}:${TIKTOK_CLIENT_SECRET}`).toString('base64')}`
          }
        }
      );

      const { access_token: new_access_token, refresh_token: new_refresh_token } = response.data;

      await pool.query(
        `UPDATE social_accounts SET access_token = $1, page_access_token = $2, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $3 AND platform = 'tiktok'`,
        [new_access_token, new_refresh_token || refresh_token, resolvedUserId]
      );

      return new_access_token;
    };

    // Attempt to post video
    const doPost = async (token) => {
      return await axios.post(
        'https://open.tiktokapis.com/v2/post/publish/video/init/',
        {
          post_info: {
            title: caption || '',
            privacy_level: 'PUBLIC_TO_EVERYONE',
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false
          },
          source_info: { source: 'PULL_FROM_URL', video_url: videoUrl }
        },
        { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
    };

    try {
      const initResponse = await doPost(access_token);
      return res.json({ success: true, publishId: initResponse.data.data?.publish_id });

    } catch (postError) {
      const errCode = postError.response?.data?.error?.code;

      // Token expired or scope issue — try refresh then retry
      if (postError.response?.status === 401 || errCode === 'access_token_invalid' || errCode === 'scope_not_authorized') {
        if (!refresh_token) {
          return res.status(401).json({
            success: false,
            error: 'TikTok token expired. Please reconnect your TikTok account.'
          });
        }

        try {
          access_token = await refreshAccessToken();
          const retryResponse = await doPost(access_token);
          return res.json({ success: true, publishId: retryResponse.data.data?.publish_id });
        } catch (refreshError) {
          // Refresh failed — user must reconnect
          return res.status(401).json({
            success: false,
            error: 'TikTok session expired. Please reconnect your TikTok account.'
          });
        }
      }

      throw postError;
    }

  } catch (error) {
    console.error('TikTok post error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message });
  }
});

app.get('/api/tiktok/analytics', async (req, res) => {
  try {
    const userId = req.query.userId || 1;
    const dbResult = await pool.query(
      `SELECT access_token, instagram_account_name FROM social_accounts WHERE user_id = $1 AND platform = 'tiktok'`,
      [userId]
    );
    if (dbResult.rows.length === 0) return res.status(400).json({ success: false, error: 'TikTok not connected' });

    const { access_token, instagram_account_name: displayName } = dbResult.rows[0];
    const userResponse = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
      headers: { 'Authorization': `Bearer ${access_token}` },
      params: { fields: 'open_id,display_name,avatar_url' }
    });

    const userInfo = userResponse.data.data.user;
    res.json({ success: true, username: userInfo.display_name || displayName, followerCount: 0, followingCount: 0, videoCount: 0, profileLink: '' });
  } catch (error) {
    console.error('TikTok analytics error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message });
  }
});

app.get('/api/tiktok/videos', async (req, res) => {
  try {
    const userId = req.query.userId || 1;
    const dbResult = await pool.query(
      `SELECT access_token FROM social_accounts WHERE user_id = $1 AND platform = 'tiktok'`,
      [userId]
    );
    if (dbResult.rows.length === 0) return res.status(400).json({ success: false, error: 'TikTok not connected' });

    const { access_token } = dbResult.rows[0];
    const response = await axios.post(
      'https://open.tiktokapis.com/v2/video/list/',
      { max_count: 20 },
      {
        headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        params: { fields: 'id,title,create_time,cover_image_url,share_url,view_count,like_count,comment_count,share_count' }
      }
    );

    res.json({ success: true, videos: response.data.data?.videos || [] });
  } catch (error) {
    console.error('TikTok videos error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message });
  }
});

// ================================================================
// TWITTER/X OAuth & INTEGRATION ROUTES
// ================================================================
app.post('/api/twitter/post', async (req, res) => {
  try {
    const { text, userId } = req.body;
    const resolvedUserId = userId || 1;

    const dbResult = await pool.query(
      `SELECT access_token, page_access_token FROM social_accounts WHERE user_id = $1 AND platform = 'twitter'`,
      [resolvedUserId]
    );
    if (dbResult.rows.length === 0)
      return res.status(400).json({ success: false, error: 'Twitter not connected' });

    let { access_token, page_access_token: refresh_token } = dbResult.rows[0];

    // Helper to refresh the access token
    const refreshAccessToken = async () => {
      const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID;
      const TWITTER_CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET;

      const response = await axios.post(
        'https://api.twitter.com/2/oauth2/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token,
          client_id: TWITTER_CLIENT_ID
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${Buffer.from(`${TWITTER_CLIENT_ID}:${TWITTER_CLIENT_SECRET}`).toString('base64')}`
          }
        }
      );

      const { access_token: new_access_token, refresh_token: new_refresh_token } = response.data;

      // Save new tokens to DB
      await pool.query(
        `UPDATE social_accounts SET access_token = $1, page_access_token = $2, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $3 AND platform = 'twitter'`,
        [new_access_token, new_refresh_token || refresh_token, resolvedUserId]
      );

      return new_access_token;
    };

    // Try posting, refresh token if 401
    try {
      const response = await axios.post(
        'https://api.twitter.com/2/tweets',
        { text },
        { headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' } }
      );
      return res.json({ success: true, tweetId: response.data.data.id });

    } catch (postError) {
      const status = postError.response?.status;
      const errorCode = postError.response?.data?.error?.code;

      // If unauthorized or scope error, try refreshing token
      if (status === 401 || errorCode === 'scope_not_authorized') {
        if (!refresh_token) {
          return res.status(401).json({
            success: false,
            error: 'Twitter token expired. Please reconnect your Twitter account.'
          });
        }

        access_token = await refreshAccessToken();

        // Retry post with new token
        const retryResponse = await axios.post(
          'https://api.twitter.com/2/tweets',
          { text },
          { headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' } }
        );
        return res.json({ success: true, tweetId: retryResponse.data.data.id });
      }

      throw postError;
    }

  } catch (error) {
    console.error('Twitter post error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data?.detail || error.message });
  }
});

// ================================================================
// LINKEDIN OAuth & INTEGRATION ROUTES
// ================================================================

app.get('/api/auth/linkedin', (req, res) => {
  const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
  const REDIRECT_URI = `${process.env.BACKEND_URL}/api/auth/linkedin/callback`;
  const authUrl =
    `https://www.linkedin.com/oauth/v2/authorization?response_type=code` +
    `&client_id=${LINKEDIN_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=openid%20profile%20email%20w_member_social`;
  res.redirect(authUrl);
});

app.get('/api/auth/linkedin/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect(`${process.env.FRONTEND_URL}/settings?linkedin_error=true&reason=no_code`);

  try {
    const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
    const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
    const REDIRECT_URI = `${process.env.BACKEND_URL}/api/auth/linkedin/callback`;

    const tokenResponse = await axios.post(
      'https://www.linkedin.com/oauth/v2/accessToken',
      new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, client_id: LINKEDIN_CLIENT_ID, client_secret: LINKEDIN_CLIENT_SECRET }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const accessToken = tokenResponse.data.access_token;

    const profileResponse = await axios.get('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const profile = profileResponse.data;
    const accountId = profile.sub;
    const accountName = profile.name || `${profile.given_name || ''} ${profile.family_name || ''}`.trim();

    await ensureSocialAccountsTable();

    await pool.query(
      `INSERT INTO social_accounts (user_id, platform, access_token, account_id, account_name, username)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, platform)
       DO UPDATE SET
         access_token = EXCLUDED.access_token,
         account_id   = EXCLUDED.account_id,
         account_name = EXCLUDED.account_name,
         username     = EXCLUDED.username,
         updated_at   = CURRENT_TIMESTAMP`,
      [1, 'linkedin', accessToken, accountId, accountName, accountName]
    );

    res.redirect(
      `${process.env.FRONTEND_URL}/settings?linkedin_connected=true&linkedin_name=${encodeURIComponent(accountName)}&linkedin_id=${encodeURIComponent(accountId)}`
    );
  } catch (error) {
    console.error('LinkedIn OAuth error:', error.response?.data || error.message);
    res.redirect(
      `${process.env.FRONTEND_URL}/settings?linkedin_error=true&reason=${encodeURIComponent(error.response?.data?.error_description || error.message)}`
    );
  }
});

app.get('/api/auth/linkedin/load', async (req, res) => {
  try {
    await ensureSocialAccountsTable();
    const userId = req.query.userId || 1;

    const result = await pool.query(
      `SELECT id, user_id, platform, account_id, account_name, username, created_at, updated_at
       FROM social_accounts WHERE user_id = $1 AND platform = 'linkedin' LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({ success: false, connected: false, message: 'LinkedIn account not connected' });
    }

    const account = result.rows[0];
    res.json({
      success: true, connected: true,
      account: { id: account.id, userId: account.user_id, platform: account.platform, accountId: account.account_id, accountName: account.account_name, username: account.username, createdAt: account.created_at, updatedAt: account.updated_at }
    });
  } catch (err) {
    console.error('LinkedIn load error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/linkedin/post', async (req, res) => {
  try {
    const { text, userId } = req.body;
    const resolvedUserId = userId || 1;
    const dbResult = await pool.query(
      `SELECT access_token, account_id FROM social_accounts WHERE user_id = $1 AND platform = 'linkedin'`,
      [resolvedUserId]
    );
    if (dbResult.rows.length === 0) return res.status(400).json({ success: false, error: 'LinkedIn not connected' });

    const { access_token, account_id } = dbResult.rows[0];
    const response = await axios.post(
      'https://api.linkedin.com/v2/ugcPosts',
      {
        author: `urn:li:person:${account_id}`,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': { shareCommentary: { text }, shareMediaCategory: 'NONE' }
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
      },
      { headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' } }
    );

    res.json({ success: true, postId: response.data.id });
  } catch (error) {
    console.error('LinkedIn post error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data?.message || error.message });
  }
});

app.delete('/api/auth/linkedin/disconnect', async (req, res) => {
  try {
    const userId = req.query.userId || 1;
    await pool.query(`DELETE FROM social_accounts WHERE user_id = $1 AND platform = 'linkedin'`, [userId]);
    res.json({ success: true, message: 'LinkedIn disconnected' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ================================================================
// AI CONTENT GENERATION ROUTES
// ================================================================

app.post('/api/ai/generate-caption', async (req, res) => {
  try {
    const { topic, tone, length, clientId, includeEmojis, includeHashtags } = req.body;
    const client = clients.get(clientId);
    const brandVoice = client?.brandVoice || 'professional';

    const prompt = `You are a social media content creator.

Generate a ${length || 'medium'} length social media caption about: ${topic || 'an exciting update'}

Requirements:
- Tone: ${tone || 'engaging'}
- Brand voice: ${brandVoice}
${includeEmojis ? '- Include relevant emojis' : '- No emojis'}
${includeHashtags ? '- Include 3-5 relevant hashtags at the end' : '- No hashtags'}
- Make it attention-grabbing and shareable
- Keep it authentic and relatable

Return only the caption, nothing else.`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.8,
      max_tokens: 200
    });

    res.json({ success: true, caption: completion.choices[0].message.content.trim() });
  } catch (error) {
    console.error('Caption generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/ai/generate-variations', async (req, res) => {
  try {
    const { caption, count, clientId } = req.body;
    const client = clients.get(clientId);
    const brandVoice = client?.brandVoice || 'professional';

    const prompt = `Rewrite this social media caption ${count || 3} different ways, keeping the same message but varying the style.

Original: "${caption}"
Brand voice: ${brandVoice}

Return ONLY a raw JSON array with no extra text, no markdown, no code blocks. Example format:
["variation one here", "variation two here", "variation three here"]`;

    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama3-8b-8192',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.9,
        max_tokens: 500
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const raw = response.data.choices[0].message.content.trim();

    // Safely extract JSON array even if model adds extra text
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON array found in AI response');

    const variations = JSON.parse(match[0]);
    res.json({ success: true, variations });

  } catch (error) {
    console.error('AI variations error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/ai/generate-hashtags', async (req, res) => {
  try {
    const { content, industry, count } = req.body;

    const prompt = `Generate ${count || 10} relevant hashtags for this social media post:

"${content}"

Industry: ${industry || 'general'}

Requirements:
- Mix of popular and niche hashtags
- Relevant to the content
- Include industry-specific tags
- Return as space-separated list

Format: #hashtag1 #hashtag2 #hashtag3`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 150
    });

    const hashtagsText = completion.choices[0].message.content.trim();
    const hashtags = hashtagsText.split(' ').filter(h => h.startsWith('#'));
    res.json({ success: true, hashtags });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/ai/generate-reply', async (req, res) => {
  try {
    const { comment, postContent, sentiment, clientId } = req.body;
    const client = clients.get(clientId);
    const brandVoice = client?.brandVoice || 'professional and friendly';

    const sentimentContext =
      sentiment === 'negative'
        ? 'This is a negative comment, respond with empathy and try to resolve their concern.'
        : sentiment === 'positive'
        ? 'This is a positive comment, respond with gratitude and enthusiasm.'
        : 'This is a neutral comment, respond helpfully and engage them.';

    const prompt = `You are a social media manager responding to a comment.

Original post: "${postContent}"
Comment: "${comment}"

${sentimentContext}

Brand voice: ${brandVoice}

Generate a helpful, genuine reply (max 50 words). Be conversational, not corporate.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 100
    });

    res.json({ success: true, reply: completion.choices[0].message.content.trim() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/ai/content-ideas', async (req, res) => {
  try {
    const { industry, audience, count, clientId } = req.body;
    const client = clients.get(clientId);
    const brandVoice = client?.brandVoice || 'engaging';

    const prompt = `Generate ${count || 10} creative social media post ideas for:

Industry: ${industry}
Target audience: ${audience}
Brand voice: ${brandVoice}

Make them diverse (questions, tips, behind-the-scenes, testimonials, etc.)

Return as JSON: {"ideas": ["idea1", "idea2", ...]}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.9,
      max_tokens: 400,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(completion.choices[0].message.content);
    res.json({ success: true, ideas: result.ideas || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================================================================
// POST SCHEDULING ROUTES
// ================================================================

app.post('/api/posts/schedule', async (req, res) => {
  try {
    const { clientId, content, platforms, scheduledTime, media, hashtags } = req.body;
    const result = await pool.query(
      `INSERT INTO posts (client_id, content, platforms, scheduled_time, media, hashtags, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'scheduled', NOW()) RETURNING *`,
      [clientId, content, JSON.stringify(platforms || []), scheduledTime, JSON.stringify(media || []), JSON.stringify(hashtags || [])]
    );
    res.json({ success: true, post: result.rows[0] });
  } catch (error) {
    console.error('Schedule error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/posts/scheduled/:clientId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM posts WHERE client_id = $1 AND status = 'scheduled' ORDER BY scheduled_time ASC`,
      [req.params.clientId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/posts/:clientId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM posts WHERE client_id = $1 ORDER BY created_at DESC`,
      [req.params.clientId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/posts/:postId', async (req, res) => {
  try {
    const { content, platforms, scheduledTime, hashtags } = req.body;
    const result = await pool.query(
      `UPDATE posts SET content=$1, platforms=$2, scheduled_time=$3, hashtags=$4 WHERE id=$5 RETURNING *`,
      [content, JSON.stringify(platforms), scheduledTime, JSON.stringify(hashtags), req.params.postId]
    );
    res.json({ success: true, post: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/posts/:postId', async (req, res) => {
  try {
    await pool.query(`DELETE FROM posts WHERE id = $1`, [req.params.postId]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/posts/:postId/publish', async (req, res) => {
  try {
    const postResult = await pool.query(`SELECT * FROM posts WHERE id = $1`, [req.params.postId]);
    if (postResult.rows.length === 0) return res.status(404).json({ error: 'Post not found' });

    const post = postResult.rows[0];
    const platforms = JSON.parse(post.platforms || '[]');
    const content = post.content;
    const results = {};

    for (const platform of platforms) {
      try {
        const tokenResult = await pool.query(
          `SELECT access_token, extra_data FROM social_connections WHERE platform = $1 AND status = 'connected' LIMIT 1`,
          [platform]
        );
        if (tokenResult.rows.length === 0) { results[platform] = { success: false, error: 'Not connected' }; continue; }

        const { access_token, extra_data } = tokenResult.rows[0];
        const extraData = extra_data || {};

        if (platform === 'linkedin') {
          const r = await axios.post(`${req.protocol}://${req.get('host')}/api/linkedin/post`, { content });
          results[platform] = r.data;
        } else if (platform === 'facebook') {
          const pageId = extraData.page_id;
          if (!pageId) { results[platform] = { success: false, error: 'No page ID' }; continue; }
          const ptRes = await axios.get(`https://graph.facebook.com/v18.0/${pageId}`, { params: { fields: 'access_token', access_token } });
          const postRes = await axios.post(`https://graph.facebook.com/v18.0/${pageId}/feed`, { message: content, access_token: ptRes.data.access_token });
          results[platform] = { success: true, postId: postRes.data.id };
        } else if (platform === 'instagram') {
          const igUserId = extraData.instagram_business_account_id || extraData.ig_user_id;
          if (!igUserId) { results[platform] = { success: false, error: 'No IG user ID' }; continue; }
          results[platform] = { success: false, error: 'Instagram requires an image URL' };
        } else if (platform === 'twitter') {
          const tweetRes = await axios.post(
            'https://api.twitter.com/2/tweets',
            { text: content },
            { headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' } }
          );
          results[platform] = { success: true, tweetId: tweetRes.data?.data?.id };
        } else if (platform === 'tiktok') {
          results[platform] = { success: false, error: 'TikTok requires a video URL' };
        } else if (platform === 'youtube') {
          results[platform] = { success: false, error: 'YouTube requires a video URL' };
        } else {
          results[platform] = { success: false, error: 'Unknown platform' };
        }
      } catch (err) {
        results[platform] = { success: false, error: err.response?.data?.error?.message || err.message };
      }
    }

    await pool.query(
      `UPDATE posts SET status='published', published_at=NOW(), results=$1 WHERE id=$2`,
      [JSON.stringify(results), req.params.postId]
    );

    res.json({ success: true, results });
  } catch (error) {
    console.error('Publish error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ================================================================
// ANALYTICS ROUTES
// ================================================================

app.get('/api/analytics/:clientId', (req, res) => {
  const client = clients.get(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const clientPosts = publishedPosts.filter(p => p.clientId === req.params.clientId);
  const platformStats = {};
  clientPosts.forEach(post => {
    post.platforms.forEach(platform => {
      platformStats[platform] = (platformStats[platform] || 0) + 1;
    });
  });

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const last30Days = clientPosts.filter(p => new Date(p.publishedAt) >= thirtyDaysAgo);

  res.json({
    success: true,
    analytics: {
      overview: {
        totalPosts: client.stats?.totalPosts || 0,
        scheduledPosts: client.stats?.scheduledPosts || 0,
        totalEngagement: client.stats?.totalEngagement || 0,
        totalFollowers: client.stats?.totalFollowers || 0,
        avgEngagementRate: client.stats?.avgEngagementRate || 0
      },
      platforms: platformStats,
      recentActivity: { last30Days: last30Days.length, postsPerWeek: (last30Days.length / 4).toFixed(1) },
      topPerformingPosts: clientPosts.slice(0, 5).map(p => ({
        id: p.id, content: p.content.substring(0, 100), platforms: p.platforms, publishedAt: p.publishedAt
      }))
    }
  });
});

app.get('/api/analytics/:clientId/engagement', (req, res) => {
  const { timeframe } = req.query;
  res.json({
    success: true,
    engagement: {
      likes: Math.floor(Math.random() * 1000),
      comments: Math.floor(Math.random() * 200),
      shares: Math.floor(Math.random() * 150),
      clicks: Math.floor(Math.random() * 500),
      impressions: Math.floor(Math.random() * 5000)
    },
    timeframe: timeframe || 'last30days'
  });
});

app.get('/api/analytics/:clientId/growth', (req, res) => {
  res.json({
    success: true,
    growth: {
      followers: { current: Math.floor(Math.random() * 10000), change: Math.floor(Math.random() * 200) - 100, changePercent: (Math.random() * 10 - 5).toFixed(2) },
      engagement: { current: Math.floor(Math.random() * 5000), change: Math.floor(Math.random() * 500) - 250, changePercent: (Math.random() * 15 - 7).toFixed(2) },
      reach: { current: Math.floor(Math.random() * 50000), change: Math.floor(Math.random() * 5000) - 2500, changePercent: (Math.random() * 20 - 10).toFixed(2) }
    }
  });
});

// ================================================================
// AUTO-REPLY SYSTEM
// ================================================================

app.post('/api/auto-reply/:clientId/enable', (req, res) => {
  const { rules } = req.body;
  const client = clients.get(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  client.settings = client.settings || {};
  client.settings.autoReply = true;
  client.autoReplyRules = rules || {
    keywords: {},
    sentiment: {
      positive: 'Thank you so much! 🙌',
      negative: 'We apologize for any inconvenience. Please DM us so we can help!',
      neutral: 'Thanks for your comment!'
    }
  };
  res.json({ success: true, message: 'Auto-reply enabled' });
});

app.post('/api/auto-reply/:clientId/process', async (req, res) => {
  try {
    const { comment, postId, platform } = req.body;
    const client = clients.get(req.params.clientId);
    if (!client || !client.settings?.autoReply) return res.json({ success: false, message: 'Auto-reply not enabled' });

    const aiReply = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{
        role: 'user',
        content: `Reply to this social media comment professionally:\n\nComment: "${comment}"\nBrand voice: ${client.brandVoice}\n\nKeep it brief (max 30 words), friendly, and on-brand.`
      }],
      max_tokens: 80
    });

    const reply = aiReply.choices[0].message.content.trim();
    autoReplies.push({ id: `reply_${Date.now()}`, clientId: req.params.clientId, postId, platform, comment, reply, status: 'sent', createdAt: new Date().toISOString() });
    res.json({ success: true, reply });
  } catch (error) {
    console.error('Auto-reply process error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/auto-reply/:clientId/history', (req, res) => {
  const replies = autoReplies.filter(r => r.clientId === req.params.clientId);
  res.json({ success: true, replies, total: replies.length });
});

// ================================================================
// CONTENT CALENDAR
// ================================================================

app.get('/api/calendar/:clientId', (req, res) => {
  const { month, year } = req.query;
  const posts = scheduledPosts.filter(p => {
    if (p.clientId !== req.params.clientId) return false;
    const postDate = new Date(p.scheduledTime);
    if (month !== undefined && postDate.getMonth() !== parseInt(month)) return false;
    if (year !== undefined && postDate.getFullYear() !== parseInt(year)) return false;
    return true;
  });

  const calendar = {};
  posts.forEach(post => {
    const date = new Date(post.scheduledTime).toISOString().split('T')[0];
    if (!calendar[date]) calendar[date] = [];
    calendar[date].push(post);
  });

  res.json({ success: true, calendar });
});

// ================================================================
// BEST TIME TO POST (AI-POWERED)
// ================================================================

app.get('/api/insights/:clientId/best-times', async (req, res) => {
  try {
    const client = clients.get(req.params.clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const prompt = `Based on industry best practices for ${client.industry}, suggest the 3 best times to post on social media for maximum engagement.

Return as JSON:
{
  "recommendations": [
    {"day": "Monday", "time": "9:00 AM", "reason": "..."},
    {"day": "Wednesday", "time": "12:00 PM", "reason": "..."},
    {"day": "Friday", "time": "5:00 PM", "reason": "..."}
  ]
}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(completion.choices[0].message.content);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Best times error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ================================================================
// REPORTING & EXPORT
// ================================================================

app.get('/api/reports/:clientId/monthly', (req, res) => {
  const { month, year } = req.query;
  const client = clients.get(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  res.json({
    success: true,
    report: {
      client: { name: client.name, industry: client.industry },
      period: { month: month || new Date().getMonth() + 1, year: year || new Date().getFullYear() },
      summary: {
        totalPosts: client.stats?.totalPosts || 0,
        totalEngagement: client.stats?.totalEngagement || 0,
        followerGrowth: Math.floor(Math.random() * 500),
        reachIncrease: (Math.random() * 30).toFixed(1) + '%'
      },
      platforms: Object.keys(client.socialAccounts || {}),
      topPosts: publishedPosts.filter(p => p.clientId === req.params.clientId).slice(0, 5),
      generatedAt: new Date().toISOString()
    }
  });
});

app.get('/api/export/:clientId/posts', (req, res) => {
  const posts = [...scheduledPosts, ...publishedPosts].filter(p => p.clientId === req.params.clientId);
  const csv = [
    'ID,Content,Platforms,Status,Scheduled Time,Published Time',
    ...posts.map(p =>
      `${p.id},"${(p.content || '').replace(/"/g, '""')}",${p.platforms.join('|')},${p.status},${p.scheduledTime},${p.publishedAt || 'N/A'}`
    )
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=posts-export.csv');
  res.send(csv);
});

// ================================================================
// DASHBOARD STATS
// ================================================================

app.get('/api/dashboard/stats', (req, res) => {
  const stats = {
    totalClients: clients.size,
    activeClients: Array.from(clients.values()).filter(c => c.status === 'active').length,
    totalScheduledPosts: scheduledPosts.length,
    totalPublishedPosts: publishedPosts.length,
    totalAutoReplies: autoReplies.length,
    platformsConnected: { facebook: 0, instagram: 0, twitter: 0, linkedin: 0, tiktok: 0 }
  };

  clients.forEach(client => {
    Object.keys(client.socialAccounts || {}).forEach(platform => {
      if (client.socialAccounts[platform]?.connected) {
        stats.platformsConnected[platform] = (stats.platformsConnected[platform] || 0) + 1;
      }
    });
  });

  res.json({ success: true, stats });
});

// ================================================================
// PRIVACY REDIRECT
// ================================================================

app.get('/privacy', (req, res) => {
  res.redirect('https://nnit-social-frontend-gil7.vercel.app/privacy');
});

// ================================================================
// HEALTH CHECK
// ================================================================

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'NNIT Social Automation API',
    version: '1.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ================================================================
// CRON SCHEDULER — Auto-publish scheduled posts
// ================================================================

cron.schedule('* * * * *', async () => {
  const now = new Date();
  for (let i = scheduledPosts.length - 1; i >= 0; i--) {
    const post = scheduledPosts[i];
    if (post.status === 'scheduled' && new Date(post.scheduledTime) <= now) {
      post.status = 'published';
      post.publishedAt = new Date().toISOString();
      post.results = {};
      post.platforms.forEach(platform => {
        post.results[platform] = {
          success: true,
          postId: `${platform}_${Date.now()}`,
          url: `https://${platform}.com/post/${Date.now()}`
        };
      });
      publishedPosts.push(post);
      scheduledPosts.splice(i, 1);
      const client = clients.get(post.clientId);
      if (client) {
        client.stats = client.stats || {};
        client.stats.totalPosts = (client.stats.totalPosts || 0) + 1;
        client.stats.scheduledPosts = Math.max(0, (client.stats.scheduledPosts || 0) - 1);
        client.stats.totalEngagement = (client.stats.totalEngagement || 0) + Math.floor(Math.random() * 100);
      }
    }
  }
});

// ================================================================
// YOUTUBE OAuth & INTEGRATION ROUTES
// ================================================================

// YouTube OAuth Callback
app.get('/api/auth/youtube/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error || !code) {
    return res.redirect(
      `${process.env.FRONTEND_URL}/settings?youtube_error=true&reason=${encodeURIComponent(error || 'no_code')}`
    );
  }

  try {
    const YOUTUBE_CLIENT_ID = process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
    const YOUTUBE_CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
    const REDIRECT_URI = `${process.env.BACKEND_URL}/api/auth/youtube/callback`;

    const tokenResponse = await axios.post(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        code,
        client_id: YOUTUBE_CLIENT_ID,
        client_secret: YOUTUBE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code'
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token } = tokenResponse.data;

    // ✅ FIXED: Guard — if no refresh_token, force user to reconnect properly
    if (!refresh_token) {
      console.warn('YouTube OAuth: no refresh_token returned. User must revoke and reconnect.');
      return res.redirect(
        `${process.env.FRONTEND_URL}/settings?youtube_error=true&reason=${encodeURIComponent(
          'No refresh token received. Please go to https://myaccount.google.com/permissions, revoke access for this app, then reconnect.'
        )}`
      );
    }

    const channelResponse = await axios.get(
      'https://www.googleapis.com/youtube/v3/channels',
      {
        headers: { Authorization: `Bearer ${access_token}` },
        params: { part: 'snippet,statistics', mine: true }
      }
    );

    const channel = channelResponse.data.items?.[0];
    if (!channel) {
      return res.redirect(
        `${process.env.FRONTEND_URL}/settings?youtube_error=true&reason=${encodeURIComponent('No YouTube channel found')}`
      );
    }

    const channelId = channel.id;
    const channelName = channel.snippet?.title || 'YouTube Channel';

    await ensureSocialAccountsTable();

    await pool.query(`
      INSERT INTO social_accounts
        (user_id, platform, access_token, instagram_account_id, instagram_account_name, page_id, page_access_token)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (user_id, platform)
      DO UPDATE SET
        access_token           = $3,
        instagram_account_id   = $4,
        instagram_account_name = $5,
        page_id                = $6,
        page_access_token      = $7,
        updated_at             = CURRENT_TIMESTAMP
    `, [1, 'youtube', access_token, channelId, channelName, channelId, refresh_token]);

    res.redirect(
      `${process.env.FRONTEND_URL}/settings?` +
      `youtube_connected=true` +
      `&youtube_channel=${encodeURIComponent(channelName)}` +
      `&youtube_id=${encodeURIComponent(channelId)}`
    );

  } catch (error) {
    console.error('YouTube OAuth error:', error.response?.data || error.message);
    res.redirect(
      `${process.env.FRONTEND_URL}/settings?youtube_error=true&reason=${encodeURIComponent(
        error.response?.data?.error_description || error.response?.data?.error || error.message
      )}`
    );
  }
});

// YouTube OAuth Start — UNCHANGED ✅
app.get('/api/auth/youtube', (req, res) => {
  const YOUTUBE_CLIENT_ID = process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const REDIRECT_URI = `${process.env.BACKEND_URL}/api/auth/youtube/callback`;

  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${YOUTUBE_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent('https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload')}` +
    `&access_type=offline` +
    `&prompt=consent`;

  res.redirect(authUrl);
});

// Load YouTube credentials — UNCHANGED ✅
app.get('/api/auth/youtube/load', async (req, res) => {
  try {
    const userId = req.query.userId || 1;
    await ensureSocialAccountsTable();

    const result = await pool.query(
      `SELECT id, user_id, platform, instagram_account_id, instagram_account_name, page_id, updated_at
       FROM social_accounts WHERE user_id = $1 AND platform = 'youtube'`,
      [userId]
    );

    if (result.rows.length > 0) {
      res.json({ success: true, account: result.rows[0] });
    } else {
      res.json({ success: false, account: null });
    }
  } catch (error) {
    console.error('YouTube load error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// YouTube Disconnect — UNCHANGED ✅
app.delete('/api/auth/youtube/disconnect', async (req, res) => {
  try {
    const userId = req.query.userId || 1;
    await pool.query(
      `DELETE FROM social_accounts WHERE user_id = $1 AND platform = 'youtube'`
      , [userId]
    );
    res.json({ success: true, message: 'YouTube disconnected' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ================================================================
// START SERVER
// ================================================================

const PORT = process.env.PORT || 4000;

ensureSocialAccountsTable()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`API Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize DB tables:', err.message);
    process.exit(1);
  });

module.exports = app;
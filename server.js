require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { OpenAI } = require('openai');
const Groq = require('groq-sdk');
const axios = require('axios');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Initialize AI engines
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ================================================================
// DATA STORES (Move to database in production)
// ================================================================

const clients = new Map();
const scheduledPosts = [];
const publishedPosts = [];
const autoReplies = [];
const analytics = new Map();

// ================================================================
// CLIENT MANAGEMENT ROUTES
// ================================================================

// Create new client
app.post('/api/clients', (req, res) => {
  try {
    const { name, email, industry, brandVoice, platforms, plan } = req.body;
    
    const clientId = `client_${Date.now()}`;
    const client = {
      id: clientId,
      name,
      email,
      industry,
      brandVoice: brandVoice || 'professional and friendly',
      platforms: platforms || [],
      plan: plan || 'basic',
      socialAccounts: {},
      settings: {
        autoReply: true,
        autoHashtags: true,
        bestTimePosting: true,
        contentModeration: true
      },
      stats: {
        totalPosts: 0,
        scheduledPosts: 0,
        totalEngagement: 0,
        totalFollowers: 0,
        avgEngagementRate: 0
      },
      createdAt: new Date().toISOString(),
      status: 'active'
    };
    
    clients.set(clientId, client);
    analytics.set(clientId, { daily: [], weekly: [], monthly: [] });
    
    res.json({ success: true, client });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all clients
app.get('/api/clients', (req, res) => {
  res.json({ 
    success: true, 
    clients: Array.from(clients.values()),
    total: clients.size
  });
});

// Get single client
app.get('/api/clients/:clientId', (req, res) => {
  const client = clients.get(req.params.clientId);
  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }
  res.json({ success: true, client });
});

// Update client
app.put('/api/clients/:clientId', (req, res) => {
  const client = clients.get(req.params.clientId);
  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }
  
  Object.assign(client, req.body);
  client.updatedAt = new Date().toISOString();
  clients.set(req.params.clientId, client);
  
  res.json({ success: true, client });
});

// Delete client
app.delete('/api/clients/:clientId', (req, res) => {
  clients.delete(req.params.clientId);
  analytics.delete(req.params.clientId);
  res.json({ success: true });
});

// ================================================================
// SOCIAL PLATFORM CONNECTION ROUTES
// ================================================================

// Connect Facebook
app.post('/api/clients/:clientId/connect/facebook', (req, res) => {
  const { accessToken, pageId, pageName } = req.body;
  const client = clients.get(req.params.clientId);
  
  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }
  
  client.socialAccounts.facebook = {
    connected: true,
    accessToken,
    pageId,
    pageName,
    connectedAt: new Date().toISOString()
  };
  
  res.json({ success: true, message: 'Facebook connected' });
});

// Instagram
app.post('/api/clients/:clientId/connect/instagram', (req, res) => {
  const { accessToken, accountId, username } = req.body;
  const client = clients.get(req.params.clientId);
  
  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }
  
  client.socialAccounts.instagram = {
    connected: true,
    accessToken,
    accountId,
    username,
    connectedAt: new Date().toISOString()
  };
  
  res.json({ success: true, message: 'Instagram connected' });
});

// Instagram OAuth Start
app.get('/api/auth/instagram', (req, res) => {
  const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
  const REDIRECT_URI = `${process.env.BACKEND_URL}/api/auth/instagram/callback`;

  const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?` +
    `client_id=${FACEBOOK_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=instagram_basic,instagram_manage_insights,pages_show_list,pages_read_engagement` +
    `&response_type=code`;

  res.redirect(authUrl);
});

// Instagram OAuth Callback
app.get('/api/auth/instagram/callback', async (req, res) => {
  const { code } = req.query;
  
  if (!code) {
    return res.redirect(`${process.env.FRONTEND_URL}/settings?error=no_code`);
  }

  try {
    const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
    const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
    const REDIRECT_URI = `${process.env.BACKEND_URL}/api/auth/instagram/callback`;

    // Exchange code for access token
    const tokenUrl = `https://graph.facebook.com/v18.0/oauth/access_token?` +
      `client_id=${FACEBOOK_APP_ID}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&client_secret=${FACEBOOK_APP_SECRET}` +
      `&code=${code}`;

    const tokenResponse = await axios.get(tokenUrl);
    const accessToken = tokenResponse.data.access_token;

    // Get user's pages
    const pagesUrl = `https://graph.facebook.com/v18.0/me/accounts?access_token=${accessToken}`;
    const pagesResponse = await axios.get(pagesUrl);

    if (!pagesResponse.data.data || pagesResponse.data.data.length === 0) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings?error=no_pages`);
    }

    const pageAccessToken = pagesResponse.data.data[0].access_token;
    const pageId = pagesResponse.data.data[0].id;

    const igAccountUrl = `https://graph.facebook.com/v18.0/${pageId}?fields=instagram_business_account&access_token=${pageAccessToken}`;
    const igAccountResponse = await axios.get(igAccountUrl);

    if (!igAccountResponse.data.instagram_business_account) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings?error=no_instagram`);
    }

    const instagramAccountId = igAccountResponse.data.instagram_business_account.id;

    const usernameUrl = `https://graph.facebook.com/v18.0/${instagramAccountId}?fields=username&access_token=${pageAccessToken}`;
    const usernameResponse = await axios.get(usernameUrl);
    const username = usernameResponse.data.username;

    // Auto-create table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS social_accounts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL DEFAULT 1,
        platform VARCHAR(50) NOT NULL,
        access_token TEXT,
        instagram_account_id VARCHAR(100),
        instagram_account_name VARCHAR(100),
        page_id VARCHAR(100),
        page_access_token TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, platform)
      )
    `);

    // Save directly to DB from callback
    try {
      await pool.query(`
        INSERT INTO social_accounts (user_id, platform, access_token, instagram_account_id, instagram_account_name, page_id, page_access_token)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (user_id, platform)
        DO UPDATE SET
          access_token = $3,
          instagram_account_id = $4,
          instagram_account_name = $5,
          page_id = $6,
          page_access_token = $7,
          updated_at = CURRENT_TIMESTAMP
      `, [1, 'instagram', accessToken, instagramAccountId, username, pageId, pageAccessToken]);
    } catch (dbError) {
      console.error('DB save error in callback:', dbError.message);
    }

    // Redirect to frontend with all credentials
    res.redirect(
      `${process.env.FRONTEND_URL}/settings?` +
      `instagram_connected=true` +
      `&access_token=${pageAccessToken}` +
      `&account_id=${instagramAccountId}` +
      `&username=${username}` +
      `&user_id=1`
    );

  } catch (error) {
    console.error('Instagram OAuth error:', error.response?.data || error.message);
    res.redirect(`${process.env.FRONTEND_URL}/settings?instagram_error=true&reason=${encodeURIComponent(error.response?.data?.error?.message || error.message)}`);
  }
});

// Instagram Deauthorize Callback
app.post('/api/auth/instagram/deauthorize', (req, res) => {
  console.log('Instagram deauthorize callback received:', req.body);
  res.sendStatus(200);
});

// Instagram Data Deletion Callback
app.post('/api/auth/instagram/delete', (req, res) => {
  const { signed_request } = req.body;
  console.log('Instagram data deletion request:', signed_request);
  
  res.json({
    url: `${process.env.FRONTEND_URL}/data-deletion`,
    confirmation_code: `deletion_${Date.now()}`
  });
});

// Save Instagram credentials to database
app.post('/api/auth/instagram/save', async (req, res) => {
  try {
    const { userId, accessToken, instagramAccountId, username, pageId, pageAccessToken } = req.body;

    const resolvedUserId = userId || 1;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS social_accounts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL DEFAULT 1,
        platform VARCHAR(50) NOT NULL,
        access_token TEXT,
        instagram_account_id VARCHAR(100),
        instagram_account_name VARCHAR(100),
        page_id VARCHAR(100),
        page_access_token TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, platform)
      )
    `);

    const query = `
      INSERT INTO social_accounts (user_id, platform, access_token, instagram_account_id, instagram_account_name, page_id, page_access_token)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (user_id, platform) 
      DO UPDATE SET 
        access_token = $3,
        instagram_account_id = $4,
        instagram_account_name = $5,
        page_id = $6,
        page_access_token = $7,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const result = await pool.query(query, [
      resolvedUserId,
      'instagram',
      accessToken,
      instagramAccountId,
      username,
      pageId,
      pageAccessToken
    ]);

    res.json({ success: true, account: result.rows[0] });
  } catch (error) {
    console.error('Error saving Instagram credentials:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Quick Instagram API test routes (static token/account)
const PAGE_ACCESS_TOKEN = "EAATUZASHqqAEBQnefueBtGMRgplYQ5ZCMHaX0zSz0AEjRskVYwK76N9CVxZC5jPpzQvZBx2EnxZAylWZC36pfFLT1DG0Sx1w4MJL4sBKGCwFYaOyUFH3a8sGCYh2VOozCZBziaZBrrwdZBtBtuZCpt7vuMWlRC2wslwBnosLBQO1ZCZBQpZB2IlCYvs9KkjFTYuj6MiMV41KUZCFXkzjefxfc9f4p6M9sqISPqVVF2uPb2gU5y7GLqBSj0WHq5EEoZD";
const INSTAGRAM_ACCOUNT_ID = "61588057627958";

// Test Instagram API
app.get('/api/instagram/test', async (req, res) => {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${INSTAGRAM_ACCOUNT_ID}?fields=name,username,profile_picture_url,followers_count,media_count&access_token=${PAGE_ACCESS_TOKEN}`
    );
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Instagram Media
app.get('/api/instagram/media', async (req, res) => {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${INSTAGRAM_ACCOUNT_ID}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count&access_token=${PAGE_ACCESS_TOKEN}`
    );
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Load Instagram credentials from database
app.get('/api/auth/instagram/load', async (req, res) => {
  try {
    const userId = req.query.userId || 1;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS social_accounts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL DEFAULT 1,
        platform VARCHAR(50) NOT NULL,
        access_token TEXT,
        instagram_account_id VARCHAR(100),
        instagram_account_name VARCHAR(100),
        page_id VARCHAR(100),
        page_access_token TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, platform)
      )
    `);

    const result = await pool.query(
      `SELECT * FROM social_accounts WHERE user_id = $1 AND platform = 'instagram'`,
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

// Connect Twitter/X
app.post('/api/clients/:clientId/connect/twitter', (req, res) => {
  const { accessToken, accessSecret, username } = req.body;
  const client = clients.get(req.params.clientId);
  
  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }
  
  client.socialAccounts.twitter = {
    connected: true,
    accessToken,
    accessSecret,
    username,
    connectedAt: new Date().toISOString()
  };
  
  res.json({ success: true, message: 'Twitter connected' });
});

// Connect LinkedIn
app.post('/api/clients/:clientId/connect/linkedin', (req, res) => {
  const { accessToken, personId, companyId, name } = req.body;
  const client = clients.get(req.params.clientId);
  
  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }
  
  client.socialAccounts.linkedin = {
    connected: true,
    accessToken,
    personId,
    companyId,
    name,
    connectedAt: new Date().toISOString()
  };
  
  res.json({ success: true, message: 'LinkedIn connected' });
});

// Connect TikTok
app.post('/api/clients/:clientId/connect/tiktok', (req, res) => {
  const { accessToken, openId, username } = req.body;
  const client = clients.get(req.params.clientId);
  
  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }
  
  client.socialAccounts.tiktok = {
    connected: true,
    accessToken,
    openId,
    username,
    connectedAt: new Date().toISOString()
  };
  
  res.json({ success: true, message: 'TikTok connected' });
});

// Get connected platforms
app.get('/api/clients/:clientId/platforms', (req, res) => {
  const client = clients.get(req.params.clientId);
  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }
  
  const platforms = Object.keys(client.socialAccounts).map(platform => ({
    name: platform,
    connected: client.socialAccounts[platform].connected,
    connectedAt: client.socialAccounts[platform].connectedAt
  }));
  
  res.json({ success: true, platforms });
});

// ================================================================
// AI CONTENT GENERATION ROUTES
// ================================================================

// AI Caption Generation - Using Groq
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

    const caption = completion.choices[0].message.content.trim();
    
    res.json({ success: true, caption });
  } catch (error) {
    console.error('Caption generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate multiple caption variations
app.post('/api/ai/generate-variations', async (req, res) => {
  try {
    const { caption, count, clientId } = req.body;
    
    const client = clients.get(clientId);
    const brandVoice = client?.brandVoice || 'professional';
    
    const prompt = `Rewrite this social media caption ${count || 3} different ways, keeping the same message but varying the style:

Original: "${caption}"

Brand voice: ${brandVoice}

Return as JSON array: ["variation1", "variation2", "variation3"]`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.9,
      max_tokens: 300,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(completion.choices[0].message.content);
    const variations = result.variations || [];
    
    res.json({ success: true, variations });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate hashtags
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

// AI-powered comment reply
app.post('/api/ai/generate-reply', async (req, res) => {
  try {
    const { comment, postContent, sentiment, clientId } = req.body;
    
    const client = clients.get(clientId);
    const brandVoice = client?.brandVoice || 'professional and friendly';
    
    const sentimentContext = sentiment === 'negative' 
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

    const reply = completion.choices[0].message.content.trim();
    
    res.json({ success: true, reply });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Content ideas generator
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
    const ideas = result.ideas || [];
    
    res.json({ success: true, ideas });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================================================================
// POST SCHEDULING ROUTES
// ================================================================

// Schedule a post
app.post('/api/posts/schedule', (req, res) => {
  try {
    const {
      clientId,
      content,
      platforms,
      scheduledTime,
      media,
      hashtags
    } = req.body;
    
    const client = clients.get(clientId);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    const post = {
      id: `post_${Date.now()}`,
      clientId,
      content,
      platforms: platforms || [],
      scheduledTime: new Date(scheduledTime),
      media: media || [],
      hashtags: hashtags || [],
      status: 'scheduled',
      createdAt: new Date().toISOString(),
      results: {}
    };
    
    scheduledPosts.push(post);
    client.stats.scheduledPosts++;
    
    res.json({ success: true, post });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get scheduled posts for a client
app.get('/api/posts/scheduled/:clientId', (req, res) => {
  const posts = scheduledPosts.filter(p => 
    p.clientId === req.params.clientId && p.status === 'scheduled'
  );
  
  res.json({ success: true, posts, total: posts.length });
});

// Get all posts for a client
app.get('/api/posts/:clientId', (req, res) => {
  const allPosts = [
    ...scheduledPosts.filter(p => p.clientId === req.params.clientId),
    ...publishedPosts.filter(p => p.clientId === req.params.clientId)
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  res.json({ success: true, posts: allPosts, total: allPosts.length });
});

// Update scheduled post
app.put('/api/posts/:postId', (req, res) => {
  const postIndex = scheduledPosts.findIndex(p => p.id === req.params.postId);
  
  if (postIndex === -1) {
    return res.status(404).json({ error: 'Post not found' });
  }
  
  scheduledPosts[postIndex] = {
    ...scheduledPosts[postIndex],
    ...req.body,
    updatedAt: new Date().toISOString()
  };
  
  res.json({ success: true, post: scheduledPosts[postIndex] });
});

// Delete scheduled post
app.delete('/api/posts/:postId', (req, res) => {
  const postIndex = scheduledPosts.findIndex(p => p.id === req.params.postId);
  
  if (postIndex === -1) {
    return res.status(404).json({ error: 'Post not found' });
  }
  
  const post = scheduledPosts[postIndex];
  const client = clients.get(post.clientId);
  if (client) {
    client.stats.scheduledPosts--;
  }
  
  scheduledPosts.splice(postIndex, 1);
  
  res.json({ success: true });
});

// Publish post immediately
app.post('/api/posts/:postId/publish', async (req, res) => {
  const postIndex = scheduledPosts.findIndex(p => p.id === req.params.postId);
  
  if (postIndex === -1) {
    return res.status(404).json({ error: 'Post not found' });
  }
  
  const post = scheduledPosts[postIndex];
  
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
  scheduledPosts.splice(postIndex, 1);
  
  const client = clients.get(post.clientId);
  if (client) {
    client.stats.totalPosts++;
    client.stats.scheduledPosts--;
  }
  
  res.json({ success: true, post });
});

// ================================================================
// ANALYTICS ROUTES
// ================================================================

// Get client analytics
app.get('/api/analytics/:clientId', (req, res) => {
  const client = clients.get(req.params.clientId);
  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }
  
  const clientPosts = publishedPosts.filter(p => p.clientId === req.params.clientId);
  
  const platformStats = {};
  clientPosts.forEach(post => {
    post.platforms.forEach(platform => {
      platformStats[platform] = (platformStats[platform] || 0) + 1;
    });
  });
  
  const last30Days = clientPosts.filter(p => {
    const postDate = new Date(p.publishedAt);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return postDate >= thirtyDaysAgo;
  });
  
  const analyticsData = {
    overview: {
      totalPosts: client.stats.totalPosts,
      scheduledPosts: client.stats.scheduledPosts,
      totalEngagement: client.stats.totalEngagement || 0,
      totalFollowers: client.stats.totalFollowers || 0,
      avgEngagementRate: client.stats.avgEngagementRate || 0
    },
    platforms: platformStats,
    recentActivity: {
      last30Days: last30Days.length,
      postsPerWeek: (last30Days.length / 4).toFixed(1)
    },
    topPerformingPosts: clientPosts
      .slice(0, 5)
      .map(p => ({
        id: p.id,
        content: p.content.substring(0, 100),
        platforms: p.platforms,
        publishedAt: p.publishedAt
      }))
  };
  
  res.json({ success: true, analytics: analyticsData });
});

// Get engagement metrics
app.get('/api/analytics/:clientId/engagement', (req, res) => {
  const { timeframe } = req.query;
  
  const engagement = {
    likes: Math.floor(Math.random() * 1000),
    comments: Math.floor(Math.random() * 200),
    shares: Math.floor(Math.random() * 150),
    clicks: Math.floor(Math.random() * 500),
    impressions: Math.floor(Math.random() * 5000)
  };
  
  res.json({ success: true, engagement, timeframe });
});

// Get growth metrics
app.get('/api/analytics/:clientId/growth', (req, res) => {
  const growth = {
    followers: {
      current: Math.floor(Math.random() * 10000),
      change: Math.floor(Math.random() * 200) - 100,
      changePercent: (Math.random() * 10 - 5).toFixed(2)
    },
    engagement: {
      current: Math.floor(Math.random() * 5000),
      change: Math.floor(Math.random() * 500) - 250,
      changePercent: (Math.random() * 15 - 7).toFixed(2)
    },
    reach: {
      current: Math.floor(Math.random() * 50000),
      change: Math.floor(Math.random() * 5000) - 2500,
      changePercent: (Math.random() * 20 - 10).toFixed(2)
    }
  };
  
  res.json({ success: true, growth });
});

// ================================================================
// AUTO-REPLY SYSTEM
// ================================================================

// Enable auto-reply for client
app.post('/api/auto-reply/:clientId/enable', (req, res) => {
  const { rules } = req.body;
  const client = clients.get(req.params.clientId);
  
  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }
  
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

// Process incoming comment (webhook simulation)
app.post('/api/auto-reply/:clientId/process', async (req, res) => {
  try {
    const { comment, postId, platform } = req.body;
    const client = clients.get(req.params.clientId);
    
    if (!client || !client.settings.autoReply) {
      return res.json({ success: false, message: 'Auto-reply not enabled' });
    }
    
    const aiReply = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{
        role: 'user',
        content: `Reply to this social media comment professionally:
        
Comment: "${comment}"
Brand voice: ${client.brandVoice}

Keep it brief (max 30 words), friendly, and on-brand.`
      }],
      max_tokens: 80
    });
    
    const reply = aiReply.choices[0].message.content.trim();
    
    autoReplies.push({
      id: `reply_${Date.now()}`,
      clientId: req.params.clientId,
      postId,
      platform,
      comment,
      reply,
      status: 'sent',
      createdAt: new Date().toISOString()
    });
    
    res.json({ success: true, reply });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get auto-reply history
app.get('/api/auto-reply/:clientId/history', (req, res) => {
  const replies = autoReplies.filter(r => r.clientId === req.params.clientId);
  res.json({ success: true, replies, total: replies.length });
});

// ================================================================
// CONTENT CALENDAR
// ================================================================

// Get calendar view
app.get('/api/calendar/:clientId', (req, res) => {
  const { month, year } = req.query;
  
  const posts = scheduledPosts.filter(p => {
    if (p.clientId !== req.params.clientId) return false;
    
    const postDate = new Date(p.scheduledTime);
    if (month && postDate.getMonth() !== parseInt(month)) return false;
    if (year && postDate.getFullYear() !== parseInt(year)) return false;
    
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
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    const prompt = `Based on industry best practices for ${client.industry}, suggest the 3 best times to post on social media for maximum engagement.

Return as JSON: {
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
    res.status(500).json({ error: error.message });
  }
});

// ================================================================
// REPORTING & EXPORT
// ================================================================

// Generate monthly report
app.get('/api/reports/:clientId/monthly', (req, res) => {
  const { month, year } = req.query;
  const client = clients.get(req.params.clientId);
  
  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }
  
  const report = {
    client: {
      name: client.name,
      industry: client.industry
    },
    period: {
      month: month || new Date().getMonth() + 1,
      year: year || new Date().getFullYear()
    },
    summary: {
      totalPosts: client.stats.totalPosts,
      totalEngagement: client.stats.totalEngagement,
      followerGrowth: Math.floor(Math.random() * 500),
      reachIncrease: (Math.random() * 30).toFixed(1) + '%'
    },
    platforms: Object.keys(client.socialAccounts),
    topPosts: publishedPosts
      .filter(p => p.clientId === req.params.clientId)
      .slice(0, 5),
    generatedAt: new Date().toISOString()
  };
  
  res.json({ success: true, report });
});

// Export data as CSV
app.get('/api/export/:clientId/posts', (req, res) => {
  const posts = [...scheduledPosts, ...publishedPosts]
    .filter(p => p.clientId === req.params.clientId);
  
  const csv = [
    'ID,Content,Platforms,Status,Scheduled Time,Published Time',
    ...posts.map(p => 
      `${p.id},"${p.content}",${p.platforms.join('|')},${p.status},${p.scheduledTime},${p.publishedAt || 'N/A'}`
    )
  ].join('\n');
  
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=posts-export.csv');
  res.send(csv);
});

// ================================================================
// CRON SCHEDULER - Auto-publish posts
// ================================================================

cron.schedule('* * * * *', async () => {
  const now = new Date();
  
  for (let i = scheduledPosts.length - 1; i >= 0; i--) {
    const post = scheduledPosts[i];
    
    if (post.status === 'scheduled' && new Date(post.scheduledTime) <= now) {
      console.log(`🔤 Publishing post ${post.id} to ${post.platforms.join(', ')}`);
      
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
        client.stats.totalPosts++;
        client.stats.scheduledPosts--;
        client.stats.totalEngagement += Math.floor(Math.random() * 100);
      }
    }
  }
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
    platformsConnected: {
      facebook: 0,
      instagram: 0,
      twitter: 0,
      linkedin: 0,
      tiktok: 0
    }
  };
  
  clients.forEach(client => {
    Object.keys(client.socialAccounts).forEach(platform => {
      if (client.socialAccounts[platform].connected) {
        stats.platformsConnected[platform]++;
      }
    });
  });
  
  res.json({ success: true, stats });
});

// ================================================================
// FACEBOOK OAuth & INTEGRATION ROUTES
// Add these routes to server.js (before the /health route)
// ================================================================

// Facebook OAuth Start
app.get('/api/auth/facebook', (req, res) => {
  const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
  const REDIRECT_URI = `${process.env.BACKEND_URL}/api/auth/facebook/callback`;

  const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?` +
    `client_id=${FACEBOOK_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=pages_show_list,pages_read_engagement,pages_manage_posts,pages_read_user_content,read_insights` +
    `&response_type=code`;

  res.redirect(authUrl);
});

// Facebook OAuth Callback
app.get('/api/auth/facebook/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.redirect(`${process.env.FRONTEND_URL}/settings?facebook_error=true&reason=no_code`);
  }

  try {
    const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
    const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
    const REDIRECT_URI = `${process.env.BACKEND_URL}/api/auth/facebook/callback`;

    // Exchange code for user access token
    const tokenUrl = `https://graph.facebook.com/v18.0/oauth/access_token?` +
      `client_id=${FACEBOOK_APP_ID}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&client_secret=${FACEBOOK_APP_SECRET}` +
      `&code=${code}`;

    const tokenResponse = await axios.get(tokenUrl);
    const userAccessToken = tokenResponse.data.access_token;

    // Get user info
    const userUrl = `https://graph.facebook.com/v18.0/me?fields=id,name&access_token=${userAccessToken}`;
    const userResponse = await axios.get(userUrl);
    const { id: facebookUserId, name: facebookUserName } = userResponse.data;

    // Get pages
    const pagesUrl = `https://graph.facebook.com/v18.0/me/accounts?access_token=${userAccessToken}`;
    const pagesResponse = await axios.get(pagesUrl);

    if (!pagesResponse.data.data || pagesResponse.data.data.length === 0) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings?facebook_error=true&reason=no_pages`);
    }

    const page = pagesResponse.data.data[0];
    const pageAccessToken = page.access_token;
    const pageId = page.id;
    const pageName = page.name;

    // Save to DB
    await pool.query(`
      CREATE TABLE IF NOT EXISTS social_accounts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL DEFAULT 1,
        platform VARCHAR(50) NOT NULL,
        access_token TEXT,
        instagram_account_id VARCHAR(100),
        instagram_account_name VARCHAR(100),
        page_id VARCHAR(100),
        page_access_token TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, platform)
      )
    `);

    await pool.query(`
      INSERT INTO social_accounts (user_id, platform, access_token, instagram_account_name, page_id, page_access_token)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id, platform)
      DO UPDATE SET
        access_token = $3,
        instagram_account_name = $4,
        page_id = $5,
        page_access_token = $6,
        updated_at = CURRENT_TIMESTAMP
    `, [1, 'facebook', userAccessToken, pageName, pageId, pageAccessToken]);

    res.redirect(
      `${process.env.FRONTEND_URL}/settings?` +
      `facebook_connected=true` +
      `&facebook_page_id=${pageId}` +
      `&facebook_page_name=${encodeURIComponent(pageName)}` +
      `&facebook_page_token=${pageAccessToken}`
    );

  } catch (error) {
    console.error('Facebook OAuth error:', error.response?.data || error.message);
    res.redirect(`${process.env.FRONTEND_URL}/settings?facebook_error=true&reason=${encodeURIComponent(error.response?.data?.error?.message || error.message)}`);
  }
});

// Load Facebook credentials from DB
app.get('/api/auth/facebook/load', async (req, res) => {
  try {
    const userId = req.query.userId || 1;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS social_accounts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL DEFAULT 1,
        platform VARCHAR(50) NOT NULL,
        access_token TEXT,
        instagram_account_id VARCHAR(100),
        instagram_account_name VARCHAR(100),
        page_id VARCHAR(100),
        page_access_token TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, platform)
      )
    `);

    const result = await pool.query(
      `SELECT * FROM social_accounts WHERE user_id = $1 AND platform = 'facebook'`,
      [userId]
    );

    if (result.rows.length > 0) {
      res.json({ success: true, account: result.rows[0] });
    } else {
      res.json({ success: false, account: null });
    }
  } catch (error) {
    console.error('Facebook load error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Save Facebook credentials to DB
app.post('/api/auth/facebook/save', async (req, res) => {
  try {
    const { userId, pageId, pageName, pageAccessToken, accessToken } = req.body;
    const resolvedUserId = userId || 1;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS social_accounts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL DEFAULT 1,
        platform VARCHAR(50) NOT NULL,
        access_token TEXT,
        instagram_account_id VARCHAR(100),
        instagram_account_name VARCHAR(100),
        page_id VARCHAR(100),
        page_access_token TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, platform)
      )
    `);

    const result = await pool.query(`
      INSERT INTO social_accounts (user_id, platform, access_token, instagram_account_name, page_id, page_access_token)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id, platform)
      DO UPDATE SET
        access_token = $3,
        instagram_account_name = $4,
        page_id = $5,
        page_access_token = $6,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [resolvedUserId, 'facebook', accessToken, pageName, pageId, pageAccessToken]);

    res.json({ success: true, account: result.rows[0] });
  } catch (error) {
    console.error('Facebook save error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ================================================================
// FACEBOOK POSTING
// ================================================================

// Post text to Facebook Page
app.post('/api/facebook/post', async (req, res) => {
  try {
    const { message, link, userId } = req.body;
    const resolvedUserId = userId || 1;

    // Get page token from DB
    const dbResult = await pool.query(
      `SELECT page_id, page_access_token FROM social_accounts WHERE user_id = $1 AND platform = 'facebook'`,
      [resolvedUserId]
    );

    if (dbResult.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Facebook not connected' });
    }

    const { page_id, page_access_token } = dbResult.rows[0];

    const postData = { message, access_token: page_access_token };
    if (link) postData.link = link;

    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${page_id}/feed`,
      postData
    );

    res.json({ success: true, postId: response.data.id });
  } catch (error) {
    console.error('Facebook post error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message });
  }
});

// Post photo to Facebook Page
app.post('/api/facebook/post/photo', async (req, res) => {
  try {
    const { caption, imageUrl, userId } = req.body;
    const resolvedUserId = userId || 1;

    const dbResult = await pool.query(
      `SELECT page_id, page_access_token FROM social_accounts WHERE user_id = $1 AND platform = 'facebook'`,
      [resolvedUserId]
    );

    if (dbResult.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Facebook not connected' });
    }

    const { page_id, page_access_token } = dbResult.rows[0];

    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${page_id}/photos`,
      {
        caption,
        url: imageUrl,
        access_token: page_access_token
      }
    );

    res.json({ success: true, postId: response.data.id });
  } catch (error) {
    console.error('Facebook photo post error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message });
  }
});

// Get Facebook Page posts
app.get('/api/facebook/posts', async (req, res) => {
  try {
    const userId = req.query.userId || 1;

    const dbResult = await pool.query(
      `SELECT page_id, page_access_token FROM social_accounts WHERE user_id = $1 AND platform = 'facebook'`,
      [userId]
    );

    if (dbResult.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Facebook not connected' });
    }

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

// ================================================================
// FACEBOOK ANALYTICS
// ================================================================

// Get Page insights
app.get('/api/facebook/analytics', async (req, res) => {
  try {
    const userId = req.query.userId || 1;
    const { metric = 'page_impressions,page_engaged_users,page_fans,page_views_total', period = 'day' } = req.query;

    const dbResult = await pool.query(
      `SELECT page_id, page_access_token, instagram_account_name FROM social_accounts WHERE user_id = $1 AND platform = 'facebook'`,
      [userId]
    );

    if (dbResult.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Facebook not connected' });
    }

    const { page_id, page_access_token, instagram_account_name: pageName } = dbResult.rows[0];

    // Get page insights
    const insightsUrl = `https://graph.facebook.com/v18.0/${page_id}/insights?metric=${metric}&period=${period}&access_token=${page_access_token}`;
    const insightsResponse = await axios.get(insightsUrl);

    // Get page info (fans/followers)
    const pageInfoUrl = `https://graph.facebook.com/v18.0/${page_id}?fields=fan_count,followers_count,name&access_token=${page_access_token}`;
    const pageInfoResponse = await axios.get(pageInfoUrl);

    const insights = {};
    insightsResponse.data.data.forEach(item => {
      insights[item.name] = item.values;
    });

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

// Get post-level analytics
app.get('/api/facebook/analytics/post/:postId', async (req, res) => {
  try {
    const userId = req.query.userId || 1;

    const dbResult = await pool.query(
      `SELECT page_access_token FROM social_accounts WHERE user_id = $1 AND platform = 'facebook'`,
      [userId]
    );

    if (dbResult.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Facebook not connected' });
    }

    const { page_access_token } = dbResult.rows[0];
    const { postId } = req.params;

    const response = await axios.get(
      `https://graph.facebook.com/v18.0/${postId}/insights?metric=post_impressions,post_engaged_users,post_reactions_by_type_total,post_clicks&access_token=${page_access_token}`
    );

    const insights = {};
    response.data.data.forEach(item => {
      insights[item.name] = item.values?.[0]?.value || 0;
    });

    res.json({ success: true, postId, insights });
  } catch (error) {
    console.error('Facebook post analytics error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message });
  }
});

// Disconnect Facebook
app.delete('/api/auth/facebook/disconnect', async (req, res) => {
  try {
    const userId = req.query.userId || 1;
    await pool.query(
      `DELETE FROM social_accounts WHERE user_id = $1 AND platform = 'facebook'`,
      [userId]
    );
    res.json({ success: true, message: 'Facebook disconnected' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/privacy', (req, res) => {
  res.redirect('https://nnit-social-frontend-gil7.vercel.app/privacy');
});

// ================================================================
// TIKTOK OAuth & INTEGRATION ROUTES
// Add these routes to server.js before the /health route
// ================================================================

// TikTok OAuth Start
app.get('/api/auth/tiktok', (req, res) => {
  const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
  const REDIRECT_URI = `${process.env.BACKEND_URL}/api/auth/tiktok/callback`;
  const csrfState = Math.random().toString(36).substring(2);

  const authUrl = `https://www.tiktok.com/v2/auth/authorize?` +
    `client_key=${TIKTOK_CLIENT_KEY}` +
    `&scope=user.info.basic` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&state=${csrfState}`;

  res.redirect(authUrl);
});

// TikTok OAuth Callback
app.get('/api/auth/tiktok/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error || !code) {
    return res.redirect(`${process.env.FRONTEND_URL}/settings?tiktok_error=true&reason=${encodeURIComponent(error || 'no_code')}`);
  }

  try {
    const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
    const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
    const REDIRECT_URI = `${process.env.BACKEND_URL}/api/auth/tiktok/callback`;

    // Exchange code for access token
    const tokenResponse = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', 
      new URLSearchParams({
        client_key: TIKTOK_CLIENT_KEY,
        client_secret: TIKTOK_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI
      }).toString(),
      { 
        headers: { 
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(`${TIKTOK_CLIENT_KEY}:${TIKTOK_CLIENT_SECRET}`).toString('base64')}`
        } 
      }
    );

    const { access_token, open_id, refresh_token } = tokenResponse.data;

    // Get user info - only basic fields allowed in sandbox
    const userResponse = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
      headers: { 'Authorization': `Bearer ${access_token}` },
      params: { fields: 'open_id,union_id,avatar_url,display_name' }
    });

    const userInfo = userResponse.data.data.user;
    const displayName = userInfo.display_name || 'TikTok User';

    // Save to DB
    await pool.query(`
      CREATE TABLE IF NOT EXISTS social_accounts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL DEFAULT 1,
        platform VARCHAR(50) NOT NULL,
        access_token TEXT,
        instagram_account_id VARCHAR(100),
        instagram_account_name VARCHAR(100),
        page_id VARCHAR(100),
        page_access_token TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, platform)
      )
    `);

    await pool.query(`
      INSERT INTO social_accounts (user_id, platform, access_token, instagram_account_id, instagram_account_name, page_id, page_access_token)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (user_id, platform)
      DO UPDATE SET
        access_token = $3,
        instagram_account_id = $4,
        instagram_account_name = $5,
        page_id = $6,
        page_access_token = $7,
        updated_at = CURRENT_TIMESTAMP
    `, [1, 'tiktok', access_token, open_id, displayName, open_id, refresh_token]);

    res.redirect(
      `${process.env.FRONTEND_URL}/settings?` +
      `tiktok_connected=true` +
      `&tiktok_open_id=${open_id}` +
      `&tiktok_username=${encodeURIComponent(displayName)}` +
      `&tiktok_token=${access_token}`
    );

  } catch (error) {
    console.error('TikTok OAuth error:', error.response?.data || error.message);
    res.redirect(`${process.env.FRONTEND_URL}/settings?tiktok_error=true&reason=${encodeURIComponent(error.response?.data?.message || error.message)}`);
  }
});

// Load TikTok credentials from DB
app.get('/api/auth/tiktok/load', async (req, res) => {
  try {
    const userId = req.query.userId || 1;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS social_accounts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL DEFAULT 1,
        platform VARCHAR(50) NOT NULL,
        access_token TEXT,
        instagram_account_id VARCHAR(100),
        instagram_account_name VARCHAR(100),
        page_id VARCHAR(100),
        page_access_token TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, platform)
      )
    `);

    const result = await pool.query(
      `SELECT * FROM social_accounts WHERE user_id = $1 AND platform = 'tiktok'`,
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

// Disconnect TikTok
app.delete('/api/auth/tiktok/disconnect', async (req, res) => {
  try {
    const userId = req.query.userId || 1;
    await pool.query(
      `DELETE FROM social_accounts WHERE user_id = $1 AND platform = 'tiktok'`,
      [userId]
    );
    res.json({ success: true, message: 'TikTok disconnected' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ================================================================
// TIKTOK VIDEO POSTING
// ================================================================

// Upload video to TikTok (URL-based)
app.post('/api/tiktok/post/video', async (req, res) => {
  try {
    const { videoUrl, caption, userId } = req.body;
    const resolvedUserId = userId || 1;

    const dbResult = await pool.query(
      `SELECT access_token, instagram_account_id FROM social_accounts WHERE user_id = $1 AND platform = 'tiktok'`,
      [resolvedUserId]
    );

    if (dbResult.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'TikTok not connected' });
    }

    const { access_token, instagram_account_id: open_id } = dbResult.rows[0];

    // Initialize upload
    const initResponse = await axios.post(
      'https://open.tiktokapis.com/v2/post/publish/video/init/',
      {
        post_info: {
          title: caption || '',
          privacy_level: 'PUBLIC_TO_EVERYONE',
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: 'PULL_FROM_URL',
          video_url: videoUrl
        }
      },
      { headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' } }
    );

    res.json({ success: true, publishId: initResponse.data.data?.publish_id });
  } catch (error) {
    console.error('TikTok post error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message });
  }
});

// ================================================================
// TIKTOK ANALYTICS
// ================================================================

// Get TikTok user analytics
app.get('/api/tiktok/analytics', async (req, res) => {
  try {
    const userId = req.query.userId || 1;

    const dbResult = await pool.query(
      `SELECT access_token, instagram_account_name FROM social_accounts WHERE user_id = $1 AND platform = 'tiktok'`,
      [userId]
    );

    if (dbResult.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'TikTok not connected' });
    }

    const { access_token, instagram_account_name: displayName } = dbResult.rows[0];

    // Get user info - only basic fields
    const userResponse = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
      headers: { 'Authorization': `Bearer ${access_token}` },
      params: { fields: 'open_id,display_name,avatar_url' }
    });

    const userInfo = userResponse.data.data.user;

    res.json({
      success: true,
      username: userInfo.display_name || displayName,
      followerCount: 0,
      followingCount: 0,
      videoCount: 0,
      profileLink: ''
    });
  } catch (error) {
    console.error('TikTok analytics error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message });
  }
});

// Get TikTok video list
app.get('/api/tiktok/videos', async (req, res) => {
  try {
    const userId = req.query.userId || 1;

    const dbResult = await pool.query(
      `SELECT access_token FROM social_accounts WHERE user_id = $1 AND platform = 'tiktok'`,
      [userId]
    );

    if (dbResult.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'TikTok not connected' });
    }

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

// Twitter OAuth Start
app.get('/api/auth/twitter', (req, res) => {
  const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID;
  const REDIRECT_URI = `${process.env.BACKEND_URL}/api/auth/twitter/callback`;

  // Generate code verifier and challenge for PKCE
  const codeVerifier = Math.random().toString(36).repeat(3).substring(0, 43);
  const state = Math.random().toString(36).substring(2);

  // Store verifier in a simple way (use session/DB in production)
  app.locals.twitterCodeVerifier = codeVerifier;
  app.locals.twitterState = state;

  const authUrl = `https://twitter.com/i/oauth2/authorize?` +
    `response_type=code` +
    `&client_id=${TWITTER_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=tweet.read%20tweet.write%20users.read%20offline.access` +
    `&state=${state}` +
    `&code_challenge=${codeVerifier}` +
    `&code_challenge_method=plain`;

  res.redirect(authUrl);
});

// Twitter OAuth Callback
app.get('/api/auth/twitter/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error || !code) {
    return res.redirect(`${process.env.FRONTEND_URL}/settings?twitter_error=true&reason=${encodeURIComponent(error || 'no_code')}`);
  }

  try {
    const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID;
    const TWITTER_CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET;
    const REDIRECT_URI = `${process.env.BACKEND_URL}/api/auth/twitter/callback`;
    const codeVerifier = app.locals.twitterCodeVerifier;

    // Exchange code for access token
    const tokenResponse = await axios.post(
      'https://api.twitter.com/2/oauth2/token',
      new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: TWITTER_CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(`${TWITTER_CLIENT_ID}:${TWITTER_CLIENT_SECRET}`).toString('base64')}`
        }
      }
    );

    const { access_token, refresh_token } = tokenResponse.data;

    // Get user info
    const userResponse = await axios.get('https://api.twitter.com/2/users/me', {
      headers: { 'Authorization': `Bearer ${access_token}` },
      params: { 'user.fields': 'id,name,username,profile_image_url,public_metrics' }
    });

    const user = userResponse.data.data;
    const username = user.username;
    const displayName = user.name;
    const twitterUserId = user.id;

    // Save to DB
    await pool.query(`
      CREATE TABLE IF NOT EXISTS social_accounts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL DEFAULT 1,
        platform VARCHAR(50) NOT NULL,
        access_token TEXT,
        instagram_account_id VARCHAR(100),
        instagram_account_name VARCHAR(100),
        page_id VARCHAR(100),
        page_access_token TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, platform)
      )
    `);

    await pool.query(`
      INSERT INTO social_accounts (user_id, platform, access_token, instagram_account_id, instagram_account_name, page_id, page_access_token)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (user_id, platform)
      DO UPDATE SET
        access_token = $3,
        instagram_account_id = $4,
        instagram_account_name = $5,
        page_id = $6,
        page_access_token = $7,
        updated_at = CURRENT_TIMESTAMP
    `, [1, 'twitter', access_token, twitterUserId, displayName, username, refresh_token || '']);

    res.redirect(
      `${process.env.FRONTEND_URL}/settings?` +
      `twitter_connected=true` +
      `&twitter_username=${encodeURIComponent(username)}` +
      `&twitter_name=${encodeURIComponent(displayName)}` +
      `&twitter_id=${twitterUserId}`
    );

  } catch (error) {
    console.error('Twitter OAuth error:', error.response?.data || error.message);
    res.redirect(`${process.env.FRONTEND_URL}/settings?twitter_error=true&reason=${encodeURIComponent(JSON.stringify(error.response?.data) || error.message)}`);
  }
});

// Load Twitter credentials from DB
app.get('/api/auth/twitter/load', async (req, res) => {
  try {
    const userId = req.query.userId || 1;

    const result = await pool.query(
      `SELECT * FROM social_accounts WHERE user_id = $1 AND platform = 'twitter'`,
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

// Disconnect Twitter
app.delete('/api/auth/twitter/disconnect', async (req, res) => {
  try {
    const userId = req.query.userId || 1;
    await pool.query(
      `DELETE FROM social_accounts WHERE user_id = $1 AND platform = 'twitter'`,
      [userId]
    );
    res.json({ success: true, message: 'Twitter disconnected' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ================================================================
// TWITTER POSTING
// ================================================================

// Post a tweet
app.post('/api/twitter/post', async (req, res) => {
  try {
    const { text, userId } = req.body;
    const resolvedUserId = userId || 1;

    const dbResult = await pool.query(
      `SELECT access_token FROM social_accounts WHERE user_id = $1 AND platform = 'twitter'`,
      [resolvedUserId]
    );

    if (dbResult.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Twitter not connected' });
    }

    const { access_token } = dbResult.rows[0];

    const response = await axios.post(
      'https://api.twitter.com/2/tweets',
      { text },
      { headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' } }
    );

    res.json({ success: true, tweetId: response.data.data.id });
  } catch (error) {
    console.error('Twitter post error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data?.detail || error.message });
  }
});

// ================================================================
// TWITTER ANALYTICS
// ================================================================

app.get('/api/twitter/analytics', async (req, res) => {
  try {
    const userId = req.query.userId || 1;

    const dbResult = await pool.query(
      `SELECT access_token, instagram_account_name, page_id FROM social_accounts WHERE user_id = $1 AND platform = 'twitter'`,
      [userId]
    );

    if (dbResult.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Twitter not connected' });
    }

    const { access_token, instagram_account_name: displayName, page_id: username } = dbResult.rows[0];

    const userResponse = await axios.get('https://api.twitter.com/2/users/me', {
      headers: { 'Authorization': `Bearer ${access_token}` },
      params: { 'user.fields': 'public_metrics,profile_image_url' }
    });

    const user = userResponse.data.data;
    const metrics = user.public_metrics || {};

    res.json({
      success: true,
      username: username || displayName,
      displayName,
      followerCount: metrics.followers_count || 0,
      followingCount: metrics.following_count || 0,
      tweetCount: metrics.tweet_count || 0,
      profileImageUrl: user.profile_image_url || ''
    });
  } catch (error) {
    console.error('Twitter analytics error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data?.detail || error.message });
  }
});

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { OpenAI } = require('openai');
const Groq = require('groq-sdk');
const axios = require('axios');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Initialize AI engines
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ================================================================
// DATA STORES (Move to database in production)
// ================================================================

const clients = new Map();
const scheduledPosts = [];
const publishedPosts = [];
const autoReplies = [];
const analytics = new Map();

// ================================================================
// CLIENT MANAGEMENT ROUTES
// ================================================================

// Create new client
app.post('/api/clients', (req, res) => {
  try {
    const { name, email, industry, brandVoice, platforms, plan } = req.body;
    
    const clientId = `client_${Date.now()}`;
    const client = {
      id: clientId,
      name,
      email,
      industry,
      brandVoice: brandVoice || 'professional and friendly',
      platforms: platforms || [],
      plan: plan || 'basic',
      socialAccounts: {},
      settings: {
        autoReply: true,
        autoHashtags: true,
        bestTimePosting: true,
        contentModeration: true
      },
      stats: {
        totalPosts: 0,
        scheduledPosts: 0,
        totalEngagement: 0,
        totalFollowers: 0,
        avgEngagementRate: 0
      },
      createdAt: new Date().toISOString(),
      status: 'active'
    };
    
    clients.set(clientId, client);
    analytics.set(clientId, { daily: [], weekly: [], monthly: [] });
    
    res.json({ success: true, client });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all clients
app.get('/api/clients', (req, res) => {
  res.json({ 
    success: true, 
    clients: Array.from(clients.values()),
    total: clients.size
  });
});

// Get single client
app.get('/api/clients/:clientId', (req, res) => {
  const client = clients.get(req.params.clientId);
  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }
  res.json({ success: true, client });
});

// Update client
app.put('/api/clients/:clientId', (req, res) => {
  const client = clients.get(req.params.clientId);
  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }
  
  Object.assign(client, req.body);
  client.updatedAt = new Date().toISOString();
  clients.set(req.params.clientId, client);
  
  res.json({ success: true, client });
});

// Delete client
app.delete('/api/clients/:clientId', (req, res) => {
  clients.delete(req.params.clientId);
  analytics.delete(req.params.clientId);
  res.json({ success: true });
});

// ================================================================
// SOCIAL PLATFORM CONNECTION ROUTES
// ================================================================

// Connect Facebook
app.post('/api/clients/:clientId/connect/facebook', (req, res) => {
  const { accessToken, pageId, pageName } = req.body;
  const client = clients.get(req.params.clientId);
  
  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }
  
  client.socialAccounts.facebook = {
    connected: true,
    accessToken,
    pageId,
    pageName,
    connectedAt: new Date().toISOString()
  };
  
  res.json({ success: true, message: 'Facebook connected' });
});

// Instagram
app.post('/api/clients/:clientId/connect/instagram', (req, res) => {
  const { accessToken, accountId, username } = req.body;
  const client = clients.get(req.params.clientId);
  
  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }
  
  client.socialAccounts.instagram = {
    connected: true,
    accessToken,
    accountId,
    username,
    connectedAt: new Date().toISOString()
  };
  
  res.json({ success: true, message: 'Instagram connected' });
});

// Instagram OAuth Start
app.get('/api/auth/instagram', (req, res) => {
  const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
  const REDIRECT_URI = `${process.env.BACKEND_URL}/api/auth/instagram/callback`;

  const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?` +
    `client_id=${FACEBOOK_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=instagram_basic,instagram_manage_insights,pages_show_list,pages_read_engagement` +
    `&response_type=code`;

  res.redirect(authUrl);
});

// Instagram OAuth Callback
app.get('/api/auth/instagram/callback', async (req, res) => {
  const { code } = req.query;
  
  if (!code) {
    return res.redirect(`${process.env.FRONTEND_URL}/settings?error=no_code`);
  }

  try {
    const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
    const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
    const REDIRECT_URI = `${process.env.BACKEND_URL}/api/auth/instagram/callback`;

    const tokenUrl = `https://graph.facebook.com/v18.0/oauth/access_token?` +
      `client_id=${FACEBOOK_APP_ID}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&client_secret=${FACEBOOK_APP_SECRET}` +
      `&code=${code}`;

    const tokenResponse = await axios.get(tokenUrl);
    const accessToken = tokenResponse.data.access_token;

    const pagesUrl = `https://graph.facebook.com/v18.0/me/accounts?access_token=${accessToken}`;
    const pagesResponse = await axios.get(pagesUrl);

    if (!pagesResponse.data.data || pagesResponse.data.data.length === 0) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings?error=no_pages`);
    }

    const pageAccessToken = pagesResponse.data.data[0].access_token;
    const pageId = pagesResponse.data.data[0].id;

    const igAccountUrl = `https://graph.facebook.com/v18.0/${pageId}?fields=instagram_business_account&access_token=${pageAccessToken}`;
    const igAccountResponse = await axios.get(igAccountUrl);

    if (!igAccountResponse.data.instagram_business_account) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings?error=no_instagram`);
    }

    const instagramAccountId = igAccountResponse.data.instagram_business_account.id;

    const usernameUrl = `https://graph.facebook.com/v18.0/${instagramAccountId}?fields=username&access_token=${pageAccessToken}`;
    const usernameResponse = await axios.get(usernameUrl);
    const username = usernameResponse.data.username;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS social_accounts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL DEFAULT 1,
        platform VARCHAR(50) NOT NULL,
        access_token TEXT,
        instagram_account_id VARCHAR(100),
        instagram_account_name VARCHAR(100),
        page_id VARCHAR(100),
        page_access_token TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, platform)
      )
    `);

    try {
      await pool.query(`
        INSERT INTO social_accounts (user_id, platform, access_token, instagram_account_id, instagram_account_name, page_id, page_access_token)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (user_id, platform)
        DO UPDATE SET
          access_token = $3,
          instagram_account_id = $4,
          instagram_account_name = $5,
          page_id = $6,
          page_access_token = $7,
          updated_at = CURRENT_TIMESTAMP
      `, [1, 'instagram', accessToken, instagramAccountId, username, pageId, pageAccessToken]);
    } catch (dbError) {
      console.error('DB save error in callback:', dbError.message);
    }

    res.redirect(
      `${process.env.FRONTEND_URL}/settings?` +
      `instagram_connected=true` +
      `&access_token=${pageAccessToken}` +
      `&account_id=${instagramAccountId}` +
      `&username=${username}` +
      `&user_id=1`
    );

  } catch (error) {
    console.error('Instagram OAuth error:', error.response?.data || error.message);
    res.redirect(`${process.env.FRONTEND_URL}/settings?instagram_error=true&reason=${encodeURIComponent(error.response?.data?.error?.message || error.message)}`);
  }
});

// Instagram Deauthorize Callback
app.post('/api/auth/instagram/deauthorize', (req, res) => {
  console.log('Instagram deauthorize callback received:', req.body);
  res.sendStatus(200);
});

// Instagram Data Deletion Callback
app.post('/api/auth/instagram/delete', (req, res) => {
  const { signed_request } = req.body;
  console.log('Instagram data deletion request:', signed_request);
  
  res.json({
    url: `${process.env.FRONTEND_URL}/data-deletion`,
    confirmation_code: `deletion_${Date.now()}`
  });
});

// Save Instagram credentials to database
app.post('/api/auth/instagram/save', async (req, res) => {
  try {
    const { userId, accessToken, instagramAccountId, username, pageId, pageAccessToken } = req.body;
    const resolvedUserId = userId || 1;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS social_accounts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL DEFAULT 1,
        platform VARCHAR(50) NOT NULL,
        access_token TEXT,
        instagram_account_id VARCHAR(100),
        instagram_account_name VARCHAR(100),
        page_id VARCHAR(100),
        page_access_token TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, platform)
      )
    `);

    const result = await pool.query(`
      INSERT INTO social_accounts (user_id, platform, access_token, instagram_account_id, instagram_account_name, page_id, page_access_token)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (user_id, platform) 
      DO UPDATE SET 
        access_token = $3,
        instagram_account_id = $4,
        instagram_account_name = $5,
        page_id = $6,
        page_access_token = $7,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [resolvedUserId, 'instagram', accessToken, instagramAccountId, username, pageId, pageAccessToken]);

    res.json({ success: true, account: result.rows[0] });
  } catch (error) {
    console.error('Error saving Instagram credentials:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Quick Instagram API test routes (static token/account)
const PAGE_ACCESS_TOKEN = "EAATUZASHqqAEBQnefueBtGMRgplYQ5ZCMHaX0zSz0AEjRskVYwK76N9CVxZC5jPpzQvZBx2EnxZAylWZC36pfFLT1DG0Sx1w4MJL4sBKGCwFYaOyUFH3a8sGCYh2VOozCZBziaZBrrwdZBtBtuZCpt7vuMWlRC2wslwBnosLBQO1ZCZBQpZB2IlCYvs9KkjFTYuj6MiMV41KUZCFXkzjefxfc9f4p6M9sqISPqVVF2uPb2gU5y7GLqBSj0WHq5EEoZD";
const INSTAGRAM_ACCOUNT_ID = "61588057627958";

app.get('/api/instagram/test', async (req, res) => {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${INSTAGRAM_ACCOUNT_ID}?fields=name,username,profile_picture_url,followers_count,media_count&access_token=${PAGE_ACCESS_TOKEN}`
    );
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/instagram/media', async (req, res) => {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${INSTAGRAM_ACCOUNT_ID}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count&access_token=${PAGE_ACCESS_TOKEN}`
    );
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Load Instagram credentials from database
app.get('/api/auth/instagram/load', async (req, res) => {
  try {
    const userId = req.query.userId || 1;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS social_accounts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL DEFAULT 1,
        platform VARCHAR(50) NOT NULL,
        access_token TEXT,
        instagram_account_id VARCHAR(100),
        instagram_account_name VARCHAR(100),
        page_id VARCHAR(100),
        page_access_token TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, platform)
      )
    `);

    const result = await pool.query(
      `SELECT * FROM social_accounts WHERE user_id = $1 AND platform = 'instagram'`,
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

// Connect Twitter/X
app.post('/api/clients/:clientId/connect/twitter', (req, res) => {
  const { accessToken, accessSecret, username } = req.body;
  const client = clients.get(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  client.socialAccounts.twitter = { connected: true, accessToken, accessSecret, username, connectedAt: new Date().toISOString() };
  res.json({ success: true, message: 'Twitter connected' });
});

// Connect LinkedIn
app.post('/api/clients/:clientId/connect/linkedin', (req, res) => {
  const { accessToken, personId, companyId, name } = req.body;
  const client = clients.get(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  client.socialAccounts.linkedin = { connected: true, accessToken, personId, companyId, name, connectedAt: new Date().toISOString() };
  res.json({ success: true, message: 'LinkedIn connected' });
});

// Connect TikTok
app.post('/api/clients/:clientId/connect/tiktok', (req, res) => {
  const { accessToken, openId, username } = req.body;
  const client = clients.get(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  client.socialAccounts.tiktok = { connected: true, accessToken, openId, username, connectedAt: new Date().toISOString() };
  res.json({ success: true, message: 'TikTok connected' });
});

// Get connected platforms
app.get('/api/clients/:clientId/platforms', (req, res) => {
  const client = clients.get(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const platforms = Object.keys(client.socialAccounts).map(platform => ({
    name: platform,
    connected: client.socialAccounts[platform].connected,
    connectedAt: client.socialAccounts[platform].connectedAt
  }));
  res.json({ success: true, platforms });
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
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/ai/generate-variations', async (req, res) => {
  try {
    const { caption, count, clientId } = req.body;
    const client = clients.get(clientId);
    const brandVoice = client?.brandVoice || 'professional';
    
    const prompt = `Rewrite this social media caption ${count || 3} different ways, keeping the same message but varying the style:

Original: "${caption}"
Brand voice: ${brandVoice}

Return as JSON array: ["variation1", "variation2", "variation3"]`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.9,
      max_tokens: 300,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(completion.choices[0].message.content);
    res.json({ success: true, variations: result.variations || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    
    const sentimentContext = sentiment === 'negative' 
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

app.post('/api/posts/schedule', (req, res) => {
  try {
    const { clientId, content, platforms, scheduledTime, media, hashtags } = req.body;
    const client = clients.get(clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    
    const post = {
      id: `post_${Date.now()}`,
      clientId,
      content,
      platforms: platforms || [],
      scheduledTime: new Date(scheduledTime),
      media: media || [],
      hashtags: hashtags || [],
      status: 'scheduled',
      createdAt: new Date().toISOString(),
      results: {}
    };
    
    scheduledPosts.push(post);
    client.stats.scheduledPosts++;
    res.json({ success: true, post });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/posts/scheduled/:clientId', (req, res) => {
  const posts = scheduledPosts.filter(p => p.clientId === req.params.clientId && p.status === 'scheduled');
  res.json({ success: true, posts, total: posts.length });
});

app.get('/api/posts/:clientId', (req, res) => {
  const allPosts = [
    ...scheduledPosts.filter(p => p.clientId === req.params.clientId),
    ...publishedPosts.filter(p => p.clientId === req.params.clientId)
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, posts: allPosts, total: allPosts.length });
});

app.put('/api/posts/:postId', (req, res) => {
  const postIndex = scheduledPosts.findIndex(p => p.id === req.params.postId);
  if (postIndex === -1) return res.status(404).json({ error: 'Post not found' });
  scheduledPosts[postIndex] = { ...scheduledPosts[postIndex], ...req.body, updatedAt: new Date().toISOString() };
  res.json({ success: true, post: scheduledPosts[postIndex] });
});

app.delete('/api/posts/:postId', (req, res) => {
  const postIndex = scheduledPosts.findIndex(p => p.id === req.params.postId);
  if (postIndex === -1) return res.status(404).json({ error: 'Post not found' });
  const post = scheduledPosts[postIndex];
  const client = clients.get(post.clientId);
  if (client) client.stats.scheduledPosts--;
  scheduledPosts.splice(postIndex, 1);
  res.json({ success: true });
});

app.post('/api/posts/:postId/publish', async (req, res) => {
  const postIndex = scheduledPosts.findIndex(p => p.id === req.params.postId);
  if (postIndex === -1) return res.status(404).json({ error: 'Post not found' });
  
  const post = scheduledPosts[postIndex];
  post.status = 'published';
  post.publishedAt = new Date().toISOString();
  post.results = {};
  post.platforms.forEach(platform => {
    post.results[platform] = { success: true, postId: `${platform}_${Date.now()}`, url: `https://${platform}.com/post/${Date.now()}` };
  });
  
  publishedPosts.push(post);
  scheduledPosts.splice(postIndex, 1);
  
  const client = clients.get(post.clientId);
  if (client) { client.stats.totalPosts++; client.stats.scheduledPosts--; }
  
  res.json({ success: true, post });
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
  
  const last30Days = clientPosts.filter(p => {
    const postDate = new Date(p.publishedAt);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return postDate >= thirtyDaysAgo;
  });
  
  res.json({
    success: true,
    analytics: {
      overview: {
        totalPosts: client.stats.totalPosts,
        scheduledPosts: client.stats.scheduledPosts,
        totalEngagement: client.stats.totalEngagement || 0,
        totalFollowers: client.stats.totalFollowers || 0,
        avgEngagementRate: client.stats.avgEngagementRate || 0
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
    timeframe
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
  client.settings.autoReply = true;
  client.autoReplyRules = rules || { keywords: {}, sentiment: { positive: 'Thank you so much! 🙌', negative: 'We apologize for any inconvenience. Please DM us so we can help!', neutral: 'Thanks for your comment!' } };
  res.json({ success: true, message: 'Auto-reply enabled' });
});

app.post('/api/auto-reply/:clientId/process', async (req, res) => {
  try {
    const { comment, postId, platform } = req.body;
    const client = clients.get(req.params.clientId);
    if (!client || !client.settings.autoReply) return res.json({ success: false, message: 'Auto-reply not enabled' });
    
    const aiReply = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: `Reply to this social media comment professionally:\n\nComment: "${comment}"\nBrand voice: ${client.brandVoice}\n\nKeep it brief (max 30 words), friendly, and on-brand.` }],
      max_tokens: 80
    });
    
    const reply = aiReply.choices[0].message.content.trim();
    autoReplies.push({ id: `reply_${Date.now()}`, clientId: req.params.clientId, postId, platform, comment, reply, status: 'sent', createdAt: new Date().toISOString() });
    res.json({ success: true, reply });
  } catch (error) {
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
    if (month && postDate.getMonth() !== parseInt(month)) return false;
    if (year && postDate.getFullYear() !== parseInt(year)) return false;
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
// BEST TIME TO POST
// ================================================================

app.get('/api/insights/:clientId/best-times', async (req, res) => {
  try {
    const client = clients.get(req.params.clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    
    const prompt = `Based on industry best practices for ${client.industry}, suggest the 3 best times to post on social media for maximum engagement.

Return as JSON: {
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
      summary: { totalPosts: client.stats.totalPosts, totalEngagement: client.stats.totalEngagement, followerGrowth: Math.floor(Math.random() * 500), reachIncrease: (Math.random() * 30).toFixed(1) + '%' },
      platforms: Object.keys(client.socialAccounts),
      topPosts: publishedPosts.filter(p => p.clientId === req.params.clientId).slice(0, 5),
      generatedAt: new Date().toISOString()
    }
  });
});

app.get('/api/export/:clientId/posts', (req, res) => {
  const posts = [...scheduledPosts, ...publishedPosts].filter(p => p.clientId === req.params.clientId);
  const csv = ['ID,Content,Platforms,Status,Scheduled Time,Published Time', ...posts.map(p => `${p.id},"${p.content}",${p.platforms.join('|')},${p.status},${p.scheduledTime},${p.publishedAt || 'N/A'}`)].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=posts-export.csv');
  res.send(csv);
});

// ================================================================
// CRON SCHEDULER
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
        post.results[platform] = { success: true, postId: `${platform}_${Date.now()}`, url: `https://${platform}.com/post/${Date.now()}` };
      });
      publishedPosts.push(post);
      scheduledPosts.splice(i, 1);
      const client = clients.get(post.clientId);
      if (client) { client.stats.totalPosts++; client.stats.scheduledPosts--; client.stats.totalEngagement += Math.floor(Math.random() * 100); }
    }
  }
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
    Object.keys(client.socialAccounts).forEach(platform => {
      if (client.socialAccounts[platform].connected) stats.platformsConnected[platform]++;
    });
  });
  
  res.json({ success: true, stats });
});

// ================================================================
// FACEBOOK OAuth & INTEGRATION ROUTES
// ================================================================

app.get('/api/auth/facebook', (req, res) => {
  const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
  const REDIRECT_URI = `${process.env.BACKEND_URL}/api/auth/facebook/callback`;

  const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?` +
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

    const tokenUrl = `https://graph.facebook.com/v18.0/oauth/access_token?client_id=${FACEBOOK_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_secret=${FACEBOOK_APP_SECRET}&code=${code}`;
    const tokenResponse = await axios.get(tokenUrl);
    const userAccessToken = tokenResponse.data.access_token;

    const pagesResponse = await axios.get(`https://graph.facebook.com/v18.0/me/accounts?access_token=${userAccessToken}`);
    if (!pagesResponse.data.data || pagesResponse.data.data.length === 0) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings?facebook_error=true&reason=no_pages`);
    }

    const page = pagesResponse.data.data[0];
    const { access_token: pageAccessToken, id: pageId, name: pageName } = page;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS social_accounts (
        id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL DEFAULT 1, platform VARCHAR(50) NOT NULL,
        access_token TEXT, instagram_account_id VARCHAR(100), instagram_account_name VARCHAR(100),
        page_id VARCHAR(100), page_access_token TEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, platform)
      )
    `);

    await pool.query(`
      INSERT INTO social_accounts (user_id, platform, access_token, instagram_account_name, page_id, page_access_token)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id, platform) DO UPDATE SET
        access_token = $3, instagram_account_name = $4, page_id = $5, page_access_token = $6, updated_at = CURRENT_TIMESTAMP
    `, [1, 'facebook', userAccessToken, pageName, pageId, pageAccessToken]);

    res.redirect(`${process.env.FRONTEND_URL}/settings?facebook_connected=true&facebook_page_id=${pageId}&facebook_page_name=${encodeURIComponent(pageName)}&facebook_page_token=${pageAccessToken}`);
  } catch (error) {
    console.error('Facebook OAuth error:', error.response?.data || error.message);
    res.redirect(`${process.env.FRONTEND_URL}/settings?facebook_error=true&reason=${encodeURIComponent(error.response?.data?.error?.message || error.message)}`);
  }
});

app.get('/api/auth/facebook/load', async (req, res) => {
  try {
    const userId = req.query.userId || 1;
    await pool.query(`CREATE TABLE IF NOT EXISTS social_accounts (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL DEFAULT 1, platform VARCHAR(50) NOT NULL, access_token TEXT, instagram_account_id VARCHAR(100), instagram_account_name VARCHAR(100), page_id VARCHAR(100), page_access_token TEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, platform))`);
    const result = await pool.query(`SELECT * FROM social_accounts WHERE user_id = $1 AND platform = 'facebook'`, [userId]);
    if (result.rows.length > 0) res.json({ success: true, account: result.rows[0] });
    else res.json({ success: false, account: null });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/auth/facebook/save', async (req, res) => {
  try {
    const { userId, pageId, pageName, pageAccessToken, accessToken } = req.body;
    const resolvedUserId = userId || 1;
    await pool.query(`CREATE TABLE IF NOT EXISTS social_accounts (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL DEFAULT 1, platform VARCHAR(50) NOT NULL, access_token TEXT, instagram_account_id VARCHAR(100), instagram_account_name VARCHAR(100), page_id VARCHAR(100), page_access_token TEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, platform))`);
    const result = await pool.query(`
      INSERT INTO social_accounts (user_id, platform, access_token, instagram_account_name, page_id, page_access_token)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id, platform) DO UPDATE SET access_token = $3, instagram_account_name = $4, page_id = $5, page_access_token = $6, updated_at = CURRENT_TIMESTAMP RETURNING *
    `, [resolvedUserId, 'facebook', accessToken, pageName, pageId, pageAccessToken]);
    res.json({ success: true, account: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/facebook/post', async (req, res) => {
  try {
    const { message, link, userId } = req.body;
    const dbResult = await pool.query(`SELECT page_id, page_access_token FROM social_accounts WHERE user_id = $1 AND platform = 'facebook'`, [userId || 1]);
    if (dbResult.rows.length === 0) return res.status(400).json({ success: false, error: 'Facebook not connected' });
    const { page_id, page_access_token } = dbResult.rows[0];
    const postData = { message, access_token: page_access_token };
    if (link) postData.link = link;
    const response = await axios.post(`https://graph.facebook.com/v18.0/${page_id}/feed`, postData);
    res.json({ success: true, postId: response.data.id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message });
  }
});

app.post('/api/facebook/post/photo', async (req, res) => {
  try {
    const { caption, imageUrl, userId } = req.body;
    const dbResult = await pool.query(`SELECT page_id, page_access_token FROM social_accounts WHERE user_id = $1 AND platform = 'facebook'`, [userId || 1]);
    if (dbResult.rows.length === 0) return res.status(400).json({ success: false, error: 'Facebook not connected' });
    const { page_id, page_access_token } = dbResult.rows[0];
    const response = await axios.post(`https://graph.facebook.com/v18.0/${page_id}/photos`, { caption, url: imageUrl, access_token: page_access_token });
    res.json({ success: true, postId: response.data.id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message });
  }
});

app.get('/api/facebook/posts', async (req, res) => {
  try {
    const dbResult = await pool.query(`SELECT page_id, page_access_token FROM social_accounts WHERE user_id = $1 AND platform = 'facebook'`, [req.query.userId || 1]);
    if (dbResult.rows.length === 0) return res.status(400).json({ success: false, error: 'Facebook not connected' });
    const { page_id, page_access_token } = dbResult.rows[0];
    const response = await axios.get(`https://graph.facebook.com/v18.0/${page_id}/feed?fields=id,message,created_time,likes.summary(true),comments.summary(true),shares&access_token=${page_access_token}`);
    res.json({ success: true, posts: response.data.data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message });
  }
});

app.get('/api/facebook/analytics', async (req, res) => {
  try {
    const { metric = 'page_impressions,page_engaged_users,page_fans,page_views_total', period = 'day' } = req.query;
    const dbResult = await pool.query(`SELECT page_id, page_access_token, instagram_account_name FROM social_accounts WHERE user_id = $1 AND platform = 'facebook'`, [req.query.userId || 1]);
    if (dbResult.rows.length === 0) return res.status(400).json({ success: false, error: 'Facebook not connected' });
    const { page_id, page_access_token, instagram_account_name: pageName } = dbResult.rows[0];
    const insightsResponse = await axios.get(`https://graph.facebook.com/v18.0/${page_id}/insights?metric=${metric}&period=${period}&access_token=${page_access_token}`);
    const pageInfoResponse = await axios.get(`https://graph.facebook.com/v18.0/${page_id}?fields=fan_count,followers_count,name&access_token=${page_access_token}`);
    const insights = {};
    insightsResponse.data.data.forEach(item => { insights[item.name] = item.values; });
    res.json({ success: true, pageName: pageInfoResponse.data.name || pageName, fanCount: pageInfoResponse.data.fan_count, followersCount: pageInfoResponse.data.followers_count, insights });
  } catch (error) {
    res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message });
  }
});

app.get('/api/facebook/analytics/post/:postId', async (req, res) => {
  try {
    const dbResult = await pool.query(`SELECT page_access_token FROM social_accounts WHERE user_id = $1 AND platform = 'facebook'`, [req.query.userId || 1]);
    if (dbResult.rows.length === 0) return res.status(400).json({ success: false, error: 'Facebook not connected' });
    const { page_access_token } = dbResult.rows[0];
    const response = await axios.get(`https://graph.facebook.com/v18.0/${req.params.postId}/insights?metric=post_impressions,post_engaged_users,post_reactions_by_type_total,post_clicks&access_token=${page_access_token}`);
    const insights = {};
    response.data.data.forEach(item => { insights[item.name] = item.values?.[0]?.value || 0; });
    res.json({ success: true, postId: req.params.postId, insights });
  } catch (error) {
    res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message });
  }
});

app.delete('/api/auth/facebook/disconnect', async (req, res) => {
  try {
    await pool.query(`DELETE FROM social_accounts WHERE user_id = $1 AND platform = 'facebook'`, [req.query.userId || 1]);
    res.json({ success: true, message: 'Facebook disconnected' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/privacy', (req, res) => {
  res.redirect('https://nnit-social-frontend-gil7.vercel.app/privacy');
});

// ================================================================
// TIKTOK OAuth & INTEGRATION ROUTES
// ================================================================

app.get('/api/auth/tiktok', (req, res) => {
  const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
  const REDIRECT_URI = `${process.env.BACKEND_URL}/api/auth/tiktok/callback`;
  const csrfState = Math.random().toString(36).substring(2);

  const authUrl = `https://www.tiktok.com/v2/auth/authorize?` +
    `client_key=${TIKTOK_CLIENT_KEY}` +
    `&scope=user.info.basic` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&state=${csrfState}`;

  res.redirect(authUrl);
});

app.get('/api/auth/tiktok/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect(`${process.env.FRONTEND_URL}/settings?tiktok_error=true&reason=${encodeURIComponent(error || 'no_code')}`);

  try {
    const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
    const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
    const REDIRECT_URI = `${process.env.BACKEND_URL}/api/auth/tiktok/callback`;

    const tokenResponse = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', 
      new URLSearchParams({ client_key: TIKTOK_CLIENT_KEY, client_secret: TIKTOK_CLIENT_SECRET, code, grant_type: 'authorization_code', redirect_uri: REDIRECT_URI }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${Buffer.from(`${TIKTOK_CLIENT_KEY}:${TIKTOK_CLIENT_SECRET}`).toString('base64')}` } }
    );

    const { access_token, open_id, refresh_token } = tokenResponse.data;

    const userResponse = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
      headers: { 'Authorization': `Bearer ${access_token}` },
      params: { fields: 'open_id,union_id,avatar_url,display_name,follower_count,following_count,video_count' }
    });

    const userInfo = userResponse.data.data.user;
    const displayName = userInfo.display_name || 'TikTok User';

    await pool.query(`CREATE TABLE IF NOT EXISTS social_accounts (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL DEFAULT 1, platform VARCHAR(50) NOT NULL, access_token TEXT, instagram_account_id VARCHAR(100), instagram_account_name VARCHAR(100), page_id VARCHAR(100), page_access_token TEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, platform))`);

    await pool.query(`
      INSERT INTO social_accounts (user_id, platform, access_token, instagram_account_id, instagram_account_name, page_id, page_access_token)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (user_id, platform) DO UPDATE SET
        access_token = $3, instagram_account_id = $4, instagram_account_name = $5, page_id = $6, page_access_token = $7, updated_at = CURRENT_TIMESTAMP
    `, [1, 'tiktok', access_token, open_id, displayName, open_id, refresh_token]);

    res.redirect(`${process.env.FRONTEND_URL}/settings?tiktok_connected=true&tiktok_open_id=${open_id}&tiktok_username=${encodeURIComponent(displayName)}&tiktok_token=${access_token}`);
  } catch (error) {
    console.error('TikTok OAuth error:', error.response?.data || error.message);
    res.redirect(`${process.env.FRONTEND_URL}/settings?tiktok_error=true&reason=${encodeURIComponent(error.response?.data?.message || error.message)}`);
  }
});

app.get('/api/auth/tiktok/load', async (req, res) => {
  try {
    const userId = req.query.userId || 1;
    await pool.query(`CREATE TABLE IF NOT EXISTS social_accounts (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL DEFAULT 1, platform VARCHAR(50) NOT NULL, access_token TEXT, instagram_account_id VARCHAR(100), instagram_account_name VARCHAR(100), page_id VARCHAR(100), page_access_token TEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, platform))`);
    const result = await pool.query(`SELECT * FROM social_accounts WHERE user_id = $1 AND platform = 'tiktok'`, [userId]);
    if (result.rows.length > 0) res.json({ success: true, account: result.rows[0] });
    else res.json({ success: false, account: null });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/auth/tiktok/disconnect', async (req, res) => {
  try {
    await pool.query(`DELETE FROM social_accounts WHERE user_id = $1 AND platform = 'tiktok'`, [req.query.userId || 1]);
    res.json({ success: true, message: 'TikTok disconnected' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/tiktok/post/video', async (req, res) => {
  try {
    const { videoUrl, caption, userId } = req.body;
    const dbResult = await pool.query(`SELECT access_token, instagram_account_id FROM social_accounts WHERE user_id = $1 AND platform = 'tiktok'`, [userId || 1]);
    if (dbResult.rows.length === 0) return res.status(400).json({ success: false, error: 'TikTok not connected' });
    const { access_token } = dbResult.rows[0];
    const initResponse = await axios.post('https://open.tiktokapis.com/v2/post/publish/video/init/', {
      post_info: { title: caption || '', privacy_level: 'PUBLIC_TO_EVERYONE', disable_duet: false, disable_comment: false, disable_stitch: false },
      source_info: { source: 'PULL_FROM_URL', video_url: videoUrl }
    }, { headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' } });
    res.json({ success: true, publishId: initResponse.data.data?.publish_id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message });
  }
});

app.get('/api/tiktok/analytics', async (req, res) => {
  try {
    const dbResult = await pool.query(`SELECT access_token, instagram_account_name FROM social_accounts WHERE user_id = $1 AND platform = 'tiktok'`, [req.query.userId || 1]);
    if (dbResult.rows.length === 0) return res.status(400).json({ success: false, error: 'TikTok not connected' });
    const { access_token, instagram_account_name: displayName } = dbResult.rows[0];
    const userResponse = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
      headers: { 'Authorization': `Bearer ${access_token}` },
      params: { fields: 'open_id,display_name,follower_count,following_count,video_count,profile_deep_link' }
    });
    const userInfo = userResponse.data.data.user;
    res.json({ success: true, username: userInfo.display_name || displayName, followerCount: userInfo.follower_count || 0, followingCount: userInfo.following_count || 0, videoCount: userInfo.video_count || 0, profileLink: userInfo.profile_deep_link || '' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message });
  }
});

app.get('/api/tiktok/videos', async (req, res) => {
  try {
    const dbResult = await pool.query(`SELECT access_token FROM social_accounts WHERE user_id = $1 AND platform = 'tiktok'`, [req.query.userId || 1]);
    if (dbResult.rows.length === 0) return res.status(400).json({ success: false, error: 'TikTok not connected' });
    const { access_token } = dbResult.rows[0];
    const response = await axios.post('https://open.tiktokapis.com/v2/video/list/', { max_count: 20 }, {
      headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      params: { fields: 'id,title,create_time,cover_image_url,share_url,view_count,like_count,comment_count,share_count' }
    });
    res.json({ success: true, videos: response.data.data?.videos || [] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message });
  }
});

// ================================================================
// YOUTUBE OAuth & INTEGRATION ROUTES
// ================================================================

// YouTube OAuth Start
app.get('/api/auth/youtube', (req, res) => {
  const YOUTUBE_CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
  const REDIRECT_URI = `${process.env.BACKEND_URL}/api/auth/youtube/callback`;
  const state = Math.random().toString(36).substring(2);

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${YOUTUBE_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent('https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/userinfo.profile')}` +
    `&access_type=offline` +
    `&prompt=consent` +
    `&state=${state}`;

  res.redirect(authUrl);
});

// YouTube OAuth Callback
app.get('/api/auth/youtube/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error || !code) {
    return res.redirect(`${process.env.FRONTEND_URL}/settings?youtube_error=true&reason=${encodeURIComponent(error || 'no_code')}`);
  }

  try {
    const YOUTUBE_CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
    const YOUTUBE_CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
    const REDIRECT_URI = `${process.env.BACKEND_URL}/api/auth/youtube/callback`;

    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token',
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

    const userResponse = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': `Bearer ${access_token}` }
    });
    const { name, email } = userResponse.data;

    const channelResponse = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      headers: { 'Authorization': `Bearer ${access_token}` },
      params: { part: 'snippet,statistics', mine: true }
    });

    const channel = channelResponse.data.items?.[0];
    const channelId = channel?.id || '';
    const channelTitle = channel?.snippet?.title || name;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS social_accounts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL DEFAULT 1,
        platform VARCHAR(50) NOT NULL,
        access_token TEXT,
        instagram_account_id VARCHAR(100),
        instagram_account_name VARCHAR(100),
        page_id VARCHAR(100),
        page_access_token TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, platform)
      )
    `);

    await pool.query(`
      INSERT INTO social_accounts (user_id, platform, access_token, instagram_account_id, instagram_account_name, page_id, page_access_token)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (user_id, platform)
      DO UPDATE SET
        access_token = $3,
        instagram_account_id = $4,
        instagram_account_name = $5,
        page_id = $6,
        page_access_token = $7,
        updated_at = CURRENT_TIMESTAMP
    `, [1, 'youtube', access_token, channelId, channelTitle, email, refresh_token || '']);

    res.redirect(
      `${process.env.FRONTEND_URL}/settings?` +
      `youtube_connected=true` +
      `&youtube_channel=${encodeURIComponent(channelTitle)}` +
      `&youtube_id=${channelId}`
    );

  } catch (error) {
    console.error('YouTube OAuth error:', error.response?.data || error.message);
    res.redirect(`${process.env.FRONTEND_URL}/settings?youtube_error=true&reason=${encodeURIComponent(JSON.stringify(error.response?.data) || error.message)}`);
  }
});

// Load YouTube credentials from DB
app.get('/api/auth/youtube/load', async (req, res) => {
  try {
    const userId = req.query.userId || 1;
    const result = await pool.query(
      `SELECT * FROM social_accounts WHERE user_id = $1 AND platform = 'youtube'`,
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

// Disconnect YouTube
app.delete('/api/auth/youtube/disconnect', async (req, res) => {
  try {
    const userId = req.query.userId || 1;
    await pool.query(`DELETE FROM social_accounts WHERE user_id = $1 AND platform = 'youtube'`, [userId]);
    res.json({ success: true, message: 'YouTube disconnected' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// YouTube Analytics
app.get('/api/youtube/analytics', async (req, res) => {
  try {
    const userId = req.query.userId || 1;
    const dbResult = await pool.query(
      `SELECT access_token, instagram_account_name, instagram_account_id FROM social_accounts WHERE user_id = $1 AND platform = 'youtube'`,
      [userId]
    );
    if (dbResult.rows.length === 0) return res.status(400).json({ success: false, error: 'YouTube not connected' });

    const { access_token, instagram_account_name: channelTitle, instagram_account_id: channelId } = dbResult.rows[0];
    const channelResponse = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      headers: { 'Authorization': `Bearer ${access_token}` },
      params: { part: 'snippet,statistics', mine: true }
    });
    const channel = channelResponse.data.items?.[0];
    const stats = channel?.statistics || {};
    res.json({
      success: true,
      channelTitle: channel?.snippet?.title || channelTitle,
      channelId: channel?.id || channelId,
      subscriberCount: stats.subscriberCount || 0,
      videoCount: stats.videoCount || 0,
      viewCount: stats.viewCount || 0
    });
  } catch (error) {
    console.error('YouTube analytics error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ================================================================
// HEALTH CHECK
// ================================================================

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'NNIT Social Automation API', version: '1.0.0', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// ================================================================
// START SERVER
// ================================================================

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => { console.log(`API Server running on port ${PORT}`); });

module.exports = app;
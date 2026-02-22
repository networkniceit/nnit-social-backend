require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Environment variables
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const INSTAGRAM_BUSINESS_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

// Test endpoint
app.get('/api/instagram/test', async (req, res) => {
  try {
    const axios = require('axios');
    const url = `https://graph.facebook.com/v18.0/${INSTAGRAM_BUSINESS_ACCOUNT_ID}?fields=name,username,profile_picture_url,followers_count,media_count&access_token=${PAGE_ACCESS_TOKEN}`;
    const response = await axios.get(url);
    res.json({
      success: true,
      data: response.data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

// Get media
app.get('/api/instagram/media', async (req, res) => {
  try {
    const axios = require('axios');
    const url = `https://graph.facebook.com/v18.0/${INSTAGRAM_BUSINESS_ACCOUNT_ID}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp&access_token=${PAGE_ACCESS_TOKEN}`;
    const response = await axios.get(url);
    res.json({
      success: true,
      data: response.data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

// Get insights
app.get('/api/instagram/insights', async (req, res) => {
  try {
    const axios = require('axios');
    const url = `https://graph.facebook.com/v18.0/${INSTAGRAM_BUSINESS_ACCOUNT_ID}/insights?metric=reach,profile_views&period=day&metric_type=total_value&access_token=${PAGE_ACCESS_TOKEN}`;
    const response = await axios.get(url);
    res.json({
      success: true,
      data: response.data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

// OAuth: Initiate Instagram authorization
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

// OAuth: Handle Instagram callback
app.get('/api/auth/instagram/callback', async (req, res) => {
  try {
    const axios = require('axios');
    const code = req.query.code;
    
    if (!code) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings?error=no_code`);
    }

    // Exchange code for access token
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

    // Get user's pages
    const pagesUrl = `https://graph.facebook.com/v18.0/me/accounts?access_token=${accessToken}`;
    const pagesResponse = await axios.get(pagesUrl);
    
    if (!pagesResponse.data.data || pagesResponse.data.data.length === 0) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings?error=no_pages`);
    }

    // Get first page's Instagram Business Account
    const pageAccessToken = pagesResponse.data.data[0].access_token;
    const pageId = pagesResponse.data.data[0].id;
    
    const igAccountUrl = `https://graph.facebook.com/v18.0/${pageId}?fields=instagram_business_account&access_token=${pageAccessToken}`;
    const igAccountResponse = await axios.get(igAccountUrl);
    
    if (!igAccountResponse.data.instagram_business_account) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings?error=no_instagram`);
    }

    const instagramAccountId = igAccountResponse.data.instagram_business_account.id;
    
    // Get Instagram username
    const usernameUrl = `https://graph.facebook.com/v18.0/${instagramAccountId}?fields=username&access_token=${pageAccessToken}`;
    const usernameResponse = await axios.get(usernameUrl);
    const username = usernameResponse.data.username;

    // Redirect back to frontend with credentials
    res.redirect(
      `${process.env.FRONTEND_URL}/settings?` +
      `instagram_connected=true` +
      `&access_token=${pageAccessToken}` +
      `&account_id=${instagramAccountId}` +
      `&username=${username}`
    );

  } catch (error) {
    console.error('OAuth error:', error.response?.data || error.message);
    res.redirect(`${process.env.FRONTEND_URL}/settings?error=auth_failed`);
  }
});

// Privacy Policy route
app.get('/privacy-policy', (req, res) => {
  res.sendFile(path.join(__dirname, 'privacy-policy.html'));
});

// Contact route
app.get('/contact', (req, res) => {
  res.sendFile(path.join(__dirname, 'contact.html'));
});

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'NNIT Instagram API Running',
    endpoints: [
      '/api/instagram/test',
      '/api/instagram/media',
      '/api/instagram/insights',
      '/api/auth/instagram'
    ]
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Instagram API running on port ${PORT}`);
});
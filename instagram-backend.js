require('dotenv').config();
const express = require('express');
const cors = require('cors');

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
    const url = `https://graph.facebook.com/v18.0/${INSTAGRAM_BUSINESS_ACCOUNT_ID}/insights?metric=impressions,reach,profile_views&period=day&access_token=${PAGE_ACCESS_TOKEN}`;
    
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

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'NNIT Instagram API Running',
    endpoints: [
      '/api/instagram/test',
      '/api/instagram/media',
      '/api/instagram/insights'
    ]
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Instagram API running on port ${PORT}`);
});

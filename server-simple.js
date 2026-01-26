require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const app = express();
app.use(cors());
app.use(express.json());

const clients = new Map();
const scheduledPosts = [];

// Dummy AI - No API needed
app.post('/api/ai/generate-caption', (req, res) => {
  const captions = [
    "🚀 Exciting news! We're transforming the way businesses connect with their audience. Stay tuned for something amazing! #Innovation #Digital #Marketing",
    "💡 Innovation meets creativity! Discover how we're revolutionizing social media management. #SocialMedia #Automation #Growth",
    "✨ Your brand deserves the best! Let us help you shine online with AI-powered content. #BrandGrowth #ContentCreation #AI"
  ];
  
  const random = captions[Math.floor(Math.random() * captions.length)];
  res.json({ success: true, caption: random });
});

app.post('/api/ai/generate-hashtags', (req, res) => {
  res.json({ 
    success: true, 
    hashtags: ['#socialmedia', '#marketing', '#business', '#growth', '#automation'] 
  });
});

app.post('/api/clients', (req, res) => {
  const clientId = 'client_' + Date.now();
  const client = { id: clientId, ...req.body, stats: { totalPosts: 0, scheduledPosts: 0 } };
  clients.set(clientId, client);
  res.json({ success: true, client });
});

app.get('/api/clients', (req, res) => {
  res.json({ success: true, clients: Array.from(clients.values()), total: clients.size });
});

app.post('/api/posts/schedule', (req, res) => {
  const post = { id: 'post_' + Date.now(), ...req.body, status: 'scheduled' };
  scheduledPosts.push(post);
  res.json({ success: true, post });
});

app.get('/api/dashboard/stats', (req, res) => {
  res.json({ 
    success: true, 
    stats: { 
      totalClients: clients.size, 
      activeClients: clients.size,
      totalScheduledPosts: scheduledPosts.length,
      totalPublishedPosts: 0 
    } 
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(4000, () => console.log('✅ NNIT Backend running on port 4000 (No AI keys needed!)'));
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const Groq = require('groq-sdk');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Initialize AI engines
// OpenAI disabled - using Groq only
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ================================================================
// DATA STORES (Move to database in production)
// ================================================================

const clients = new Map();
const scheduledPosts = [];
const publishedPosts = [];
const autoReplies = [];
const analytics = new Map();
const tiktokAppConfigs = new Map(); // Store TikTok app configurations per client

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

// Connect Instagram
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
// TIKTOK APP CONFIGURATION ROUTES
// ================================================================

// Create or update TikTok app configuration
app.post('/api/clients/:clientId/tiktok/app-config', (req, res) => {
  try {
    const { clientId } = req.params;
    const client = clients.get(clientId);
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const {
      // Credentials
      clientKey,
      clientSecret,
      // Basic Information
      appIcon,
      appName,
      category,
      description,
      termsOfServiceUrl,
      privacyPolicyUrl,
      // Platforms
      platforms,
      // App Review
      reviewExplanation,
      demoVideos,
      // Products and Scopes
      products,
      scopes
    } = req.body;

    const appConfig = {
      clientId,
      credentials: {
        clientKey: clientKey || '',
        clientSecret: clientSecret || '',
        createdAt: tiktokAppConfigs.get(clientId)?.credentials?.createdAt || new Date().toISOString()
      },
      basicInfo: {
        appIcon: appIcon || '',
        appName: appName || '',
        category: category || '',
        description: description || '',
        termsOfServiceUrl: termsOfServiceUrl || '',
        privacyPolicyUrl: privacyPolicyUrl || ''
      },
      platforms: platforms || [],
      appReview: {
        explanation: reviewExplanation || '',
        demoVideos: demoVideos || [],
        status: 'draft' // draft, submitted, approved, rejected
      },
      products: products || [],
      scopes: scopes || [],
      updatedAt: new Date().toISOString(),
      createdAt: tiktokAppConfigs.get(clientId)?.createdAt || new Date().toISOString()
    };

    tiktokAppConfigs.set(clientId, appConfig);
    
    res.json({ 
      success: true, 
      message: 'TikTok app configuration saved',
      config: appConfig 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get TikTok app configuration
app.get('/api/clients/:clientId/tiktok/app-config', (req, res) => {
  try {
    const { clientId } = req.params;
    const client = clients.get(clientId);
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const appConfig = tiktokAppConfigs.get(clientId);
    
    if (!appConfig) {
      // Return empty config structure if none exists
      return res.json({
        success: true,
        config: {
          clientId,
          credentials: {
            clientKey: '',
            clientSecret: ''
          },
          basicInfo: {
            appIcon: '',
            appName: '',
            category: '',
            description: '',
            termsOfServiceUrl: '',
            privacyPolicyUrl: ''
          },
          platforms: [],
          appReview: {
            explanation: '',
            demoVideos: [],
            status: 'draft'
          },
          products: [],
          scopes: []
        }
      });
    }

    res.json({ success: true, config: appConfig });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update specific TikTok app configuration fields
app.put('/api/clients/:clientId/tiktok/app-config', (req, res) => {
  try {
    const { clientId } = req.params;
    const client = clients.get(clientId);
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    let appConfig = tiktokAppConfigs.get(clientId);
    
    if (!appConfig) {
      // Initialize if doesn't exist
      appConfig = {
        clientId,
        credentials: { clientKey: '', clientSecret: '' },
        basicInfo: {
          appIcon: '',
          appName: '',
          category: '',
          description: '',
          termsOfServiceUrl: '',
          privacyPolicyUrl: ''
        },
        platforms: [],
        appReview: {
          explanation: '',
          demoVideos: [],
          status: 'draft'
        },
        products: [],
        scopes: [],
        createdAt: new Date().toISOString()
      };
    }

    // Update fields that are provided
    const updates = req.body;
    
    if (updates.credentials) {
      appConfig.credentials = { ...appConfig.credentials, ...updates.credentials };
    }
    if (updates.basicInfo) {
      appConfig.basicInfo = { ...appConfig.basicInfo, ...updates.basicInfo };
    }
    if (updates.platforms !== undefined) {
      appConfig.platforms = updates.platforms;
    }
    if (updates.appReview) {
      appConfig.appReview = { ...appConfig.appReview, ...updates.appReview };
    }
    if (updates.products !== undefined) {
      appConfig.products = updates.products;
    }
    if (updates.scopes !== undefined) {
      appConfig.scopes = updates.scopes;
    }

    appConfig.updatedAt = new Date().toISOString();
    tiktokAppConfigs.set(clientId, appConfig);
    
    res.json({ 
      success: true, 
      message: 'TikTok app configuration updated',
      config: appConfig 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete TikTok app configuration
app.delete('/api/clients/:clientId/tiktok/app-config', (req, res) => {
  try {
    const { clientId } = req.params;
    const client = clients.get(clientId);
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    tiktokAppConfigs.delete(clientId);
    
    res.json({ 
      success: true, 
      message: 'TikTok app configuration deleted' 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get available TikTok products
app.get('/api/tiktok/products', (req, res) => {
  const products = [
    { id: 'share_kit', name: 'Share Kit', description: 'Allow users to share content to TikTok' },
    { id: 'login_kit', name: 'Login Kit', description: 'TikTok login for your app' },
    { id: 'content_posting_api', name: 'Content Posting API', description: 'Post videos directly to TikTok' },
    { id: 'research_api', name: 'Research API', description: 'Access TikTok data for research' },
    { id: 'display_api', name: 'Display API', description: 'Display TikTok content' },
    { id: 'embed_videos', name: 'Embed Videos', description: 'Embed TikTok videos in your app' },
    { id: 'data_portability_api', name: 'Data Portability API', description: 'Export user data' },
    { id: 'green_screen_kit', name: 'Green Screen Kit', description: 'Green screen effects' },
    { id: 'commercial_content_api', name: 'Commercial Content API', description: 'Manage commercial content' }
  ];
  
  res.json({ success: true, products });
});

// Get available TikTok scopes (permissions)
app.get('/api/tiktok/scopes', (req, res) => {
  const scopes = [
    { id: 'user.info.basic', name: 'Basic User Info', description: 'Access basic user profile information' },
    { id: 'user.info.profile', name: 'Profile Info', description: 'Access detailed profile information' },
    { id: 'user.info.stats', name: 'User Stats', description: 'Access user statistics' },
    { id: 'video.list', name: 'Video List', description: 'Access list of user videos' },
    { id: 'video.upload', name: 'Video Upload', description: 'Upload videos on behalf of user' },
    { id: 'video.publish', name: 'Video Publish', description: 'Publish videos' },
    { id: 'share.sound.create', name: 'Create Sound', description: 'Create custom sounds' }
  ];
  
  res.json({ success: true, scopes });
});

// Submit TikTok app for review
app.post('/api/clients/:clientId/tiktok/app-config/submit', (req, res) => {
  try {
    const { clientId } = req.params;
    const appConfig = tiktokAppConfigs.get(clientId);
    
    if (!appConfig) {
      return res.status(404).json({ error: 'TikTok app configuration not found' });
    }

    // Validate required fields
    const errors = [];
    
    if (!appConfig.basicInfo.appName) errors.push('App name is required');
    if (!appConfig.basicInfo.category) errors.push('Category is required');
    if (!appConfig.basicInfo.description) errors.push('Description is required');
    if (!appConfig.basicInfo.termsOfServiceUrl) errors.push('Terms of Service URL is required');
    if (!appConfig.basicInfo.privacyPolicyUrl) errors.push('Privacy Policy URL is required');
    if (!appConfig.platforms || appConfig.platforms.length === 0) errors.push('At least one platform is required');
    if (!appConfig.appReview.explanation) errors.push('App review explanation is required');
    if (!appConfig.appReview.demoVideos || appConfig.appReview.demoVideos.length === 0) {
      errors.push('At least one demo video is required');
    }

    if (errors.length > 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Validation failed', 
        errors 
      });
    }

    appConfig.appReview.status = 'submitted';
    appConfig.appReview.submittedAt = new Date().toISOString();
    appConfig.updatedAt = new Date().toISOString();
    
    tiktokAppConfigs.set(clientId, appConfig);
    
    res.json({ 
      success: true, 
      message: 'TikTok app submitted for review',
      config: appConfig 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
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

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
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

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
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
  
  // Simulate publishing to platforms
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
  
  // Move to published posts
  publishedPosts.push(post);
  scheduledPosts.splice(postIndex, 1);
  
  // Update client stats
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
  
  // Calculate platform distribution
  const platformStats = {};
  clientPosts.forEach(post => {
    post.platforms.forEach(platform => {
      platformStats[platform] = (platformStats[platform] || 0) + 1;
    });
  });
  
  // Calculate posting frequency
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
  const { timeframe } = req.query; // day, week, month
  
  // Simulated engagement data
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
  // Simulated growth data
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
      positive: 'Thank you so much! ÃƒÂ°Ã…Â¸Ã‹Å“Ã…Â ',
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
    
    // Generate AI reply
    const aiReply = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
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
    
    // Store the auto-reply
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
  
  // Group by date
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
    
    // Analyze past posts and generate recommendations
    const clientPosts = publishedPosts.filter(p => p.clientId === req.params.clientId);
    
    // Use AI to analyze patterns
    const prompt = `Based on industry best practices for ${client.industry}, suggest the 3 best times to post on social media for maximum engagement.

Return as JSON: {
  "recommendations": [
    {"day": "Monday", "time": "9:00 AM", "reason": "..."},
    {"day": "Wednesday", "time": "12:00 PM", "reason": "..."},
    {"day": "Friday", "time": "5:00 PM", "reason": "..."}
  ]
}`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
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
      console.log(`ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â¤ Publishing post ${post.id} to ${post.platforms.join(', ')}`);
      
      // Simulate publishing
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
      
      // Move to published
      publishedPosts.push(post);
      scheduledPosts.splice(i, 1);
      
      // Update client stats
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
// START SERVER
// ================================================================

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬â€
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ         ÃƒÂ°Ã…Â¸Ã…Â¡Ã¢â€šÂ¬ NNIT SOCIAL AUTOMATION API RUNNING ÃƒÂ°Ã…Â¸Ã…Â¡Ã¢â€šÂ¬             ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â£
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ  Port:              ${PORT}                                      ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ  Clients:           ${clients.size}                                       ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ  Scheduled Posts:   ${scheduledPosts.length}                                       ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ  Published Posts:   ${publishedPosts.length}                                       ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ  Auto-Replies:      ${autoReplies.length}                                       ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â£
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ  ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â§ Contact: networkniceit@gmail.com                          ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ  ÃƒÂ°Ã…Â¸Ã¢â‚¬ËœÃ‚Â¤ Owner: Solomon Omomeje Ayodele                            ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ  ÃƒÂ°Ã…Â¸Ã‚ÂÃ‚Â¢ NNIT - Network Nice IT Tec                                ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã…Â¡ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
  `);
});

module.exports = app;

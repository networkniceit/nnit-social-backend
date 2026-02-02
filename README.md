# NNIT Social Automation Backend

A comprehensive social media automation API with AI-powered content generation and TikTok integration.

## Features

- **Client Management** - Create and manage multiple client accounts
- **Social Platform Connections** - Connect Facebook, Instagram, Twitter/X, LinkedIn, and TikTok
- **AI Content Generation** - Generate engaging captions using Groq AI
- **Post Scheduling** - Schedule posts across multiple platforms
- **Auto-Reply** - AI-powered automatic replies to comments
- **Analytics** - Track engagement and performance metrics
- **Content Calendar** - Visual calendar for scheduled content
- **TikTok App Configuration** - Complete TikTok app management and integration

## New: TikTok App Integration API

The latest update adds comprehensive TikTok app configuration management, allowing you to:

- Store TikTok OAuth credentials (client key, client secret)
- Configure app details (icon, name, category, description)
- Select target platforms (Web, Desktop, iOS, Android)
- Manage TikTok products (Share Kit, Login Kit, Content Posting API, etc.)
- Configure permission scopes
- Submit apps for TikTok review with validation

See [TIKTOK_API_DOCS.md](./TIKTOK_API_DOCS.md) for complete API documentation.

## Quick Start

### Installation

```bash
npm install
```

### Configuration

Create a `.env` file:

```env
GROQ_API_KEY=your_groq_api_key_here
PORT=4000
```

### Running the Server

```bash
npm start
```

The server will start on port 4000 (or the port specified in your .env file).

## API Endpoints

### Health Check
```
GET /health
```

### Client Management
```
POST   /api/clients
GET    /api/clients
GET    /api/clients/:clientId
PUT    /api/clients/:clientId
DELETE /api/clients/:clientId
```

### Social Platform Connections
```
POST /api/clients/:clientId/connect/facebook
POST /api/clients/:clientId/connect/instagram
POST /api/clients/:clientId/connect/twitter
POST /api/clients/:clientId/connect/linkedin
POST /api/clients/:clientId/connect/tiktok
GET  /api/clients/:clientId/platforms
```

### TikTok App Configuration (NEW)
```
POST   /api/clients/:clientId/tiktok/app-config
GET    /api/clients/:clientId/tiktok/app-config
PUT    /api/clients/:clientId/tiktok/app-config
DELETE /api/clients/:clientId/tiktok/app-config
POST   /api/clients/:clientId/tiktok/app-config/submit
GET    /api/tiktok/products
GET    /api/tiktok/scopes
```

### AI Content Generation
```
POST /api/ai/generate-caption
POST /api/ai/generate-variations
POST /api/ai/optimize-hashtags
POST /api/ai/generate-image-prompt
POST /api/ai/suggest-posting-time
```

### Post Scheduling
```
POST   /api/posts/schedule
GET    /api/posts/scheduled/:clientId
PUT    /api/posts/:postId
DELETE /api/posts/:postId
GET    /api/posts/published/:clientId
```

### Analytics & Reporting
```
GET /api/insights/:clientId/engagement
GET /api/insights/:clientId/best-times
GET /api/reports/:clientId/monthly
GET /api/export/:clientId/posts
```

### Content Calendar
```
GET /api/calendar/:clientId
```

### Auto-Reply
```
POST /api/auto-reply/:clientId/reply
GET  /api/auto-reply/:clientId/history
```

## TikTok Integration Example

```javascript
// 1. Create a client
const client = await fetch('http://localhost:4000/api/clients', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'My Company',
    email: 'contact@company.com',
    industry: 'Technology'
  })
});

const { client: { id: clientId } } = await client.json();

// 2. Configure TikTok app
await fetch(`http://localhost:4000/api/clients/${clientId}/tiktok/app-config`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    clientKey: 'your_client_key',
    clientSecret: 'your_client_secret',
    appName: 'My Social App',
    category: 'Social Media',
    description: 'Awesome social media tool',
    termsOfServiceUrl: 'https://myapp.com/terms',
    privacyPolicyUrl: 'https://myapp.com/privacy',
    platforms: ['Web', 'iOS', 'Android'],
    reviewExplanation: 'Our app integrates with TikTok...',
    demoVideos: ['https://myapp.com/demo.mp4'],
    products: ['login_kit', 'content_posting_api'],
    scopes: ['user.info.basic', 'video.upload']
  })
});

// 3. Submit for review
await fetch(`http://localhost:4000/api/clients/${clientId}/tiktok/app-config/submit`, {
  method: 'POST'
});
```

## Technology Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **AI Engine**: Groq SDK (Llama 3.3 70B)
- **Scheduling**: node-cron
- **CORS**: Enabled for all origins

## Data Storage

Currently uses in-memory storage (Maps and Arrays). For production use, migrate to:
- MongoDB for document storage
- PostgreSQL for relational data
- Redis for caching and session management

## Security Notes

⚠️ **Important**: This is a development version. For production:

1. Add authentication and authorization
2. Encrypt sensitive data (API keys, secrets)
3. Add rate limiting
4. Implement request validation
5. Use HTTPS
6. Store credentials securely (use environment variables or secret managers)
7. Implement proper database with encrypted fields

## Contributing

This project is maintained by Network Nice IT (NNIT).

**Contact**: networkniceit@gmail.com  
**Owner**: Solomon Omomeje Ayodele

## License

Copyright © 2026 NNIT - Network Nice IT Tec

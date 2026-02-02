# TikTok App Configuration API Documentation

This document describes the TikTok app configuration endpoints added to the NNIT Social Automation API.

## Overview

The TikTok app configuration API allows you to manage TikTok app details, credentials, and settings for your clients. This includes app information, OAuth credentials, platform selection, products, scopes, and app review submission.

## Base URL

```
http://localhost:4000/api
```

## Endpoints

### 1. Create/Save TikTok App Configuration

**POST** `/clients/:clientId/tiktok/app-config`

Creates or overwrites the complete TikTok app configuration for a client.

**Request Body:**
```json
{
  "clientKey": "awmvabcdef123456",
  "clientSecret": "secretkey987654321",
  "appIcon": "https://example.com/icon.png",
  "appName": "NNIT Social Automation",
  "category": "Social Media Management",
  "description": "Manage all your social media content in one place.",
  "termsOfServiceUrl": "https://example.com/terms",
  "privacyPolicyUrl": "https://example.com/privacy",
  "platforms": ["Web", "iOS", "Android"],
  "reviewExplanation": "This app integrates with TikTok to allow users to schedule content...",
  "demoVideos": ["https://example.com/demo1.mp4"],
  "products": ["share_kit", "login_kit", "content_posting_api"],
  "scopes": ["user.info.basic", "video.upload"]
}
```

**Response:**
```json
{
  "success": true,
  "message": "TikTok app configuration saved",
  "config": {
    "clientId": "client_123",
    "credentials": {
      "clientKey": "awmvabcdef123456",
      "clientSecret": "secretkey987654321",
      "createdAt": "2026-02-02T19:00:00.000Z"
    },
    "basicInfo": {
      "appIcon": "https://example.com/icon.png",
      "appName": "NNIT Social Automation",
      "category": "Social Media Management",
      "description": "Manage all your social media content in one place.",
      "termsOfServiceUrl": "https://example.com/terms",
      "privacyPolicyUrl": "https://example.com/privacy"
    },
    "platforms": ["Web", "iOS", "Android"],
    "appReview": {
      "explanation": "This app integrates with TikTok...",
      "demoVideos": ["https://example.com/demo1.mp4"],
      "status": "draft"
    },
    "products": ["share_kit", "login_kit", "content_posting_api"],
    "scopes": ["user.info.basic", "video.upload"],
    "updatedAt": "2026-02-02T19:00:00.000Z",
    "createdAt": "2026-02-02T19:00:00.000Z"
  }
}
```

### 2. Get TikTok App Configuration

**GET** `/clients/:clientId/tiktok/app-config`

Retrieves the TikTok app configuration for a client.

**Response:**
```json
{
  "success": true,
  "config": {
    "clientId": "client_123",
    "credentials": { ... },
    "basicInfo": { ... },
    "platforms": [ ... ],
    "appReview": { ... },
    "products": [ ... ],
    "scopes": [ ... ]
  }
}
```

If no configuration exists, returns an empty structure with default values.

### 3. Update TikTok App Configuration

**PUT** `/clients/:clientId/tiktok/app-config`

Updates specific fields in the TikTok app configuration without overwriting the entire config.

**Request Body:**
```json
{
  "basicInfo": {
    "description": "Updated description text"
  },
  "products": ["share_kit", "login_kit", "content_posting_api", "display_api"]
}
```

**Response:**
```json
{
  "success": true,
  "message": "TikTok app configuration updated",
  "config": { ... }
}
```

### 4. Delete TikTok App Configuration

**DELETE** `/clients/:clientId/tiktok/app-config`

Deletes the TikTok app configuration for a client.

**Response:**
```json
{
  "success": true,
  "message": "TikTok app configuration deleted"
}
```

### 5. Get Available TikTok Products

**GET** `/tiktok/products`

Returns a list of available TikTok products that can be integrated.

**Response:**
```json
{
  "success": true,
  "products": [
    {
      "id": "share_kit",
      "name": "Share Kit",
      "description": "Allow users to share content to TikTok"
    },
    {
      "id": "login_kit",
      "name": "Login Kit",
      "description": "TikTok login for your app"
    },
    {
      "id": "content_posting_api",
      "name": "Content Posting API",
      "description": "Post videos directly to TikTok"
    }
    // ... more products
  ]
}
```

**Available Products:**
- `share_kit` - Share Kit
- `login_kit` - Login Kit
- `content_posting_api` - Content Posting API
- `research_api` - Research API
- `display_api` - Display API
- `embed_videos` - Embed Videos
- `data_portability_api` - Data Portability API
- `green_screen_kit` - Green Screen Kit
- `commercial_content_api` - Commercial Content API

### 6. Get Available TikTok Scopes

**GET** `/tiktok/scopes`

Returns a list of available TikTok permission scopes.

**Response:**
```json
{
  "success": true,
  "scopes": [
    {
      "id": "user.info.basic",
      "name": "Basic User Info",
      "description": "Access basic user profile information"
    },
    {
      "id": "video.upload",
      "name": "Video Upload",
      "description": "Upload videos on behalf of user"
    }
    // ... more scopes
  ]
}
```

**Available Scopes:**
- `user.info.basic` - Basic User Info
- `user.info.profile` - Profile Info
- `user.info.stats` - User Stats
- `video.list` - Video List
- `video.upload` - Video Upload
- `video.publish` - Video Publish
- `share.sound.create` - Create Sound

### 7. Submit App for Review

**POST** `/clients/:clientId/tiktok/app-config/submit`

Submits the TikTok app configuration for review. Validates that all required fields are present.

**Required Fields:**
- App name
- Category
- Description
- Terms of Service URL
- Privacy Policy URL
- At least one platform
- App review explanation
- At least one demo video

**Success Response:**
```json
{
  "success": true,
  "message": "TikTok app submitted for review",
  "config": {
    ...
    "appReview": {
      "status": "submitted",
      "submittedAt": "2026-02-02T19:00:00.000Z"
    }
  }
}
```

**Validation Error Response:**
```json
{
  "success": false,
  "error": "Validation failed",
  "errors": [
    "App name is required",
    "Category is required",
    "Description is required"
  ]
}
```

## Field Descriptions

### Credentials
- **clientKey** - TikTok OAuth client key/ID
- **clientSecret** - TikTok OAuth client secret

### Basic Information
- **appIcon** - URL to app icon (1024x1024px, max 5MB, JPEG/JPG/PNG)
- **appName** - Display name for the app (max 50 characters)
- **category** - App category
- **description** - App description (max 120 characters)
- **termsOfServiceUrl** - Link to Terms of Service
- **privacyPolicyUrl** - Link to Privacy Policy

### Platforms
Array of platform strings. Supported values:
- `"Web"`
- `"Desktop"`
- `"Android"`
- `"iOS"`

### App Review
- **explanation** - Detailed explanation of how products/scopes are used (max 1000 characters)
- **demoVideos** - Array of demo video URLs (mp4/mov format, max 5 files, max 50MB each)
- **status** - Review status: `"draft"`, `"submitted"`, `"approved"`, `"rejected"`

### Products & Scopes
- **products** - Array of product IDs (see available products list)
- **scopes** - Array of scope IDs (see available scopes list)

## Example Usage

### Complete Workflow

```bash
# 1. Create a client first
curl -X POST http://localhost:4000/api/clients \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Company",
    "email": "contact@mycompany.com",
    "industry": "Technology"
  }'

# Response will include clientId, e.g., "client_123"

# 2. Get available products and scopes
curl http://localhost:4000/api/tiktok/products
curl http://localhost:4000/api/tiktok/scopes

# 3. Create TikTok app configuration
curl -X POST http://localhost:4000/api/clients/client_123/tiktok/app-config \
  -H "Content-Type: application/json" \
  -d '{
    "clientKey": "your_client_key",
    "clientSecret": "your_client_secret",
    "appName": "My Social App",
    "category": "Social Media",
    "description": "A great social media management tool",
    "termsOfServiceUrl": "https://myapp.com/terms",
    "privacyPolicyUrl": "https://myapp.com/privacy",
    "platforms": ["Web", "iOS"],
    "reviewExplanation": "Our app uses TikTok login and content posting...",
    "demoVideos": ["https://myapp.com/demo.mp4"],
    "products": ["login_kit", "content_posting_api"],
    "scopes": ["user.info.basic", "video.upload"]
  }'

# 4. Get configuration
curl http://localhost:4000/api/clients/client_123/tiktok/app-config

# 5. Update configuration
curl -X PUT http://localhost:4000/api/clients/client_123/tiktok/app-config \
  -H "Content-Type: application/json" \
  -d '{
    "basicInfo": {
      "description": "Updated description"
    }
  }'

# 6. Submit for review
curl -X POST http://localhost:4000/api/clients/client_123/tiktok/app-config/submit

# 7. Delete configuration (if needed)
curl -X DELETE http://localhost:4000/api/clients/client_123/tiktok/app-config
```

## Error Handling

All endpoints return appropriate HTTP status codes:
- `200` - Success
- `400` - Bad request (validation error)
- `404` - Resource not found (client or config)
- `500` - Internal server error

Error responses have the format:
```json
{
  "error": "Error message description"
}
```

Or for validation errors:
```json
{
  "success": false,
  "error": "Validation failed",
  "errors": ["Error 1", "Error 2"]
}
```

## Notes

- All configuration data is stored in-memory and will be lost when the server restarts. In production, this should be moved to a database.
- The `clientSecret` is stored as plain text. In production, this should be encrypted.
- Demo videos should be uploaded to your own storage and URLs provided to the API.
- The submission endpoint only validates required fields. Actual TikTok API integration would require additional validation and OAuth flow implementation.

const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function getTokens(platform, userId = 1) {
  const result = await pool.query(
    `SELECT access_token, page_access_token, page_id,
            instagram_account_id, account_id, username
     FROM social_accounts
     WHERE platform = $1 AND user_id = $2
     ORDER BY updated_at DESC
     LIMIT 1`,
    [platform, userId]
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];

  if (platform === 'facebook') {
    return {
      access_token: row.page_access_token || row.access_token,
      extra_data: { page_id: row.page_id }
    };
  }
  if (platform === 'instagram') {
    return {
      access_token: row.page_access_token || row.access_token,
      extra_data: {
        instagram_business_account_id: row.instagram_account_id,
        ig_user_id: row.instagram_account_id,
      }
    };
  }
  if (platform === 'twitter') {
    const decoded = Buffer.from(row.access_token, 'base64').toString('utf8');
    const [oauth_token, oauth_token_secret] = decoded.split(':');
    return {
      access_token: row.page_access_token || row.access_token,
      oauth_token,
      oauth_token_secret,
      extra_data: {}
    };
  }
  if (platform === 'tiktok') {
    return {
      access_token: row.access_token,
      refresh_token: row.page_access_token,
      extra_data: { open_id: row.instagram_account_id || row.page_id }
    };
  }
  if (platform === 'youtube') {
    return {
      access_token: row.access_token,
      refresh_token: row.page_access_token,
      extra_data: { channel_id: row.instagram_account_id }
    };
  }
  return {
    access_token: row.access_token || row.page_access_token,
    extra_data: { account_id: row.account_id }
  };
}

// ✅ UNCHANGED
router.post('/instagram/post', async (req, res) => {
  try {
    const { content, imageUrl } = req.body;
    const tokens = await getTokens('instagram');
    if (!tokens) return res.status(401).json({ error: 'Instagram not connected' });
    const accessToken = tokens.access_token;
    const extraData   = tokens.extra_data || {};
    const igUserId    = extraData.instagram_business_account_id || extraData.ig_user_id;
    if (!igUserId) return res.status(400).json({ error: 'Instagram Business Account ID not found. Reconnect Instagram.' });
    if (!imageUrl) return res.status(400).json({ error: 'Instagram requires an image URL.' });
    const containerRes = await axios.post(
      `https://graph.facebook.com/v18.0/${igUserId}/media`,
      { caption: content, image_url: imageUrl, media_type: 'IMAGE', access_token: accessToken }
    );
    const creationId = containerRes.data.id;
    if (!creationId) return res.status(500).json({ error: 'Failed to create Instagram media container' });
    const publishRes = await axios.post(
      `https://graph.facebook.com/v18.0/${igUserId}/media_publish`,
      { creation_id: creationId, access_token: accessToken }
    );
    res.json({ success: true, postId: publishRes.data.id, platform: 'instagram' });
  } catch (err) {
    console.error('Instagram post error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error?.message || err.message });
  }
});

// ✅ UNCHANGED
router.post('/tiktok/post', async (req, res) => {
  try {
    const { content, videoUrl } = req.body;
    const tokens = await getTokens('tiktok');
    if (!tokens) return res.status(401).json({ error: 'TikTok not connected' });
    if (!videoUrl) return res.status(400).json({ error: 'TikTok requires a video URL.' });
    const accessToken = tokens.access_token;
    const initRes = await axios.post(
      'https://open.tiktokapis.com/v2/post/publish/video/init/',
      {
        post_info: {
          title:           content.substring(0, 150),
          privacy_level:   'PUBLIC_TO_EVERYONE',
          disable_duet:    false,
          disable_comment: false,
          disable_stitch:  false,
        },
        source_info: { source: 'PULL_FROM_URL', video_url: videoUrl },
      },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' } }
    );
    res.json({ success: true, publishId: initRes.data?.data?.publish_id, platform: 'tiktok' });
  } catch (err) {
    console.error('TikTok post error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error?.message || err.message });
  }
});

// ✅ FIXED — token refresh added
router.post('/youtube/post', async (req, res) => {
  try {
    const { content, videoUrl, title, userId } = req.body;
    const resolvedUserId = userId || 1;

    const tokens = await getTokens('youtube', resolvedUserId);
    if (!tokens) return res.status(401).json({ error: 'YouTube not connected' });
    if (!videoUrl) return res.status(400).json({ error: 'YouTube requires a video URL.' });

    let accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;

    // Helper: refresh Google access token
    const refreshAccessToken = async () => {
      const response = await axios.post(
        'https://oauth2.googleapis.com/token',
        new URLSearchParams({
          client_id:     process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type:    'refresh_token'
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      const newAccessToken = response.data.access_token;
      // Save new access token to DB
      await pool.query(
        `UPDATE social_accounts SET access_token = $1, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $2 AND platform = 'youtube'`,
        [newAccessToken, resolvedUserId]
      );
      return newAccessToken;
    };

    // Helper: attempt YouTube upload
    const doUpload = async (token) => {
      return await axios.post(
        'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
        {
          snippet: {
            title:       title || content?.substring(0, 100) || 'New Video',
            description: content || '',
            tags:        []
          },
          status: { privacyStatus: 'public' }
        },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
    };

    try {
      const uploadRes = await doUpload(accessToken);
      return res.json({ success: true, videoId: uploadRes.data.id, platform: 'youtube' });

    } catch (uploadErr) {
      const status = uploadErr.response?.status;

      // Token expired — refresh and retry once
      if (status === 401) {
        if (!refreshToken) {
          return res.status(401).json({
            success: false,
            error: 'YouTube token expired. Please reconnect your YouTube account.'
          });
        }
        try {
          accessToken = await refreshAccessToken();
          const retryRes = await doUpload(accessToken);
          return res.json({ success: true, videoId: retryRes.data.id, platform: 'youtube' });
        } catch (refreshErr) {
          return res.status(401).json({
            success: false,
            error: 'YouTube session expired. Please reconnect your YouTube account.'
          });
        }
      }

      throw uploadErr;
    }

  } catch (err) {
    console.error('YouTube post error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error?.message || err.message });
  }
});

// ✅ FIXED — token refresh added
router.post('/twitter/post', async (req, res) => {
  try {
    const { content, userId } = req.body;
    const resolvedUserId = userId || 1;

    const tokens = await getTokens('twitter', resolvedUserId);
    if (!tokens) return res.status(401).json({ error: 'Twitter not connected' });

    let accessToken = tokens.access_token;

    // Helper: refresh Twitter access token
    const refreshAccessToken = async () => {
      const TWITTER_CLIENT_ID     = process.env.TWITTER_CLIENT_ID;
      const TWITTER_CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET;

      // Get refresh token from DB
      const dbResult = await pool.query(
        `SELECT page_access_token FROM social_accounts WHERE user_id = $1 AND platform = 'twitter'`,
        [resolvedUserId]
      );
      const refreshToken = dbResult.rows[0]?.page_access_token;
      if (!refreshToken) throw new Error('No refresh token available');

      const response = await axios.post(
        'https://api.twitter.com/2/oauth2/token',
        new URLSearchParams({
          grant_type:    'refresh_token',
          refresh_token: refreshToken,
          client_id:     TWITTER_CLIENT_ID
        }).toString(),
        {
          headers: {
            'Content-Type':  'application/x-www-form-urlencoded',
            'Authorization': `Basic ${Buffer.from(`${TWITTER_CLIENT_ID}:${TWITTER_CLIENT_SECRET}`).toString('base64')}`
          }
        }
      );

      const { access_token: newAccessToken, refresh_token: newRefreshToken } = response.data;

      await pool.query(
        `UPDATE social_accounts SET access_token = $1, page_access_token = $2, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $3 AND platform = 'twitter'`,
        [newAccessToken, newRefreshToken || refreshToken, resolvedUserId]
      );

      return newAccessToken;
    };

    // Helper: attempt tweet
    const doTweet = async (token) => {
      return await axios.post(
        'https://api.twitter.com/2/tweets',
        { text: content },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
    };

    try {
      const tweetRes = await doTweet(accessToken);
      return res.json({ success: true, tweetId: tweetRes.data?.data?.id, platform: 'twitter' });

    } catch (tweetErr) {
      const status    = tweetErr.response?.status;
      const errCode   = tweetErr.response?.data?.error?.code;

      if (status === 401 || errCode === 'scope_not_authorized') {
        try {
          accessToken = await refreshAccessToken();
          const retryRes = await doTweet(accessToken);
          return res.json({ success: true, tweetId: retryRes.data?.data?.id, platform: 'twitter' });
        } catch (refreshErr) {
          return res.status(401).json({
            success: false,
            error: 'Twitter session expired. Please reconnect your Twitter account.'
          });
        }
      }

      throw tweetErr;
    }

  } catch (err) {
    console.error('Twitter post error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error?.message || err.message });
  }
});

// ✅ UNCHANGED
router.post('/facebook/post', async (req, res) => {
  try {
    const { content, imageUrl } = req.body;
    const tokens = await getTokens('facebook');
    if (!tokens) return res.status(401).json({ error: 'Facebook not connected' });
    const accessToken = tokens.access_token;
    const extraData   = tokens.extra_data || {};
    const pageId      = extraData.page_id;
    if (!pageId) return res.status(400).json({ error: 'Facebook Page ID not found. Reconnect Facebook.' });
    if (!accessToken) return res.status(401).json({ error: 'Facebook access token missing. Reconnect Facebook.' });
    const postPayload = { message: content, access_token: accessToken };
    if (imageUrl) postPayload.link = imageUrl;
    const postRes = await axios.post(`https://graph.facebook.com/v18.0/${pageId}/feed`, postPayload);
    res.json({ success: true, postId: postRes.data.id, platform: 'facebook' });
  } catch (err) {
    console.error('Facebook post error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error?.message || err.message });
  }
});

module.exports = router;
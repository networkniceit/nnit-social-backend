const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function getTokens(platform, userId = 1) {
  const result = await pool.query(
    `SELECT access_token, refresh_token, page_access_token, page_id,
            instagram_account_id, account_id, username
     FROM social_accounts
     WHERE platform = $1 AND user_id = $2
     ORDER BY updated_at DESC
     LIMIT 1`,
    [platform, userId]
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    access_token: row.access_token,
    refresh_token: row.refresh_token,
    extra_data: {
      page_id: row.page_id,
      instagram_business_account_id: row.instagram_account_id,
      ig_user_id: row.instagram_account_id,
    }
  };
}

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

router.post('/youtube/post', async (req, res) => {
  try {
    const { content, videoUrl, title } = req.body;
    const tokens = await getTokens('youtube');
    if (!tokens) return res.status(401).json({ error: 'YouTube not connected' });
    if (!videoUrl) return res.status(400).json({ error: 'YouTube requires a video URL.' });
    const accessToken = tokens.access_token;
    const uploadRes = await axios.post(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        snippet: { title: title || content.substring(0, 100) || 'New Video', description: content, tags: [] },
        status:  { privacyStatus: 'public' },
      },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );
    res.json({ success: true, videoId: uploadRes.data.id, platform: 'youtube' });
  } catch (err) {
    console.error('YouTube post error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error?.message || err.message });
  }
});

router.post('/twitter/post', async (req, res) => {
  try {
    const { content } = req.body;
    const tokens = await getTokens('twitter');
    if (!tokens) return res.status(401).json({ error: 'Twitter not connected' });
    const tweetRes = await axios.post(
      'https://api.twitter.com/2/tweets',
      { text: content },
      { headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' } }
    );
    res.json({ success: true, tweetId: tweetRes.data?.data?.id, platform: 'twitter' });
  } catch (err) {
    console.error('Twitter post error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error?.message || err.message });
  }
});

router.post('/facebook/post', async (req, res) => {
  try {
    const { content, imageUrl } = req.body;
    const tokens = await getTokens('facebook');
    if (!tokens) return res.status(401).json({ error: 'Facebook not connected' });
    const accessToken = tokens.access_token;
    const extraData   = tokens.extra_data || {};
    const pageId      = extraData.page_id;
    if (!pageId) return res.status(400).json({ error: 'Facebook Page ID not found. Reconnect Facebook.' });
    const pageTokenRes = await axios.get(
      `https://graph.facebook.com/v18.0/${pageId}`,
      { params: { fields: 'access_token', access_token: accessToken } }
    );
    const pageAccessToken = pageTokenRes.data.access_token;
    const postPayload = { message: content, access_token: pageAccessToken };
    if (imageUrl) postPayload.link = imageUrl;
    const postRes = await axios.post(`https://graph.facebook.com/v18.0/${pageId}/feed`, postPayload);
    res.json({ success: true, postId: postRes.data.id, platform: 'facebook' });
  } catch (err) {
    console.error('Facebook post error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error?.message || err.message });
  }
});

module.exports = router;
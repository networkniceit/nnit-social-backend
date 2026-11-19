function createTikTok(pool, http = require('axios')) {
  async function account() {
    const r = await pool.query("SELECT * FROM social_accounts WHERE platform='tiktok' AND user_id=1 ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1");
    if (!r.rows[0]) throw new Error('TikTok is not connected. Connect it in Settings.');
    return r.rows[0];
  }
  async function call(path, payload, row, retry = true) {
    try {
      const r = await http.post('https://open.tiktokapis.com/v2/' + path, payload, { timeout: 30000, headers: { Authorization: `Bearer ${row.access_token}`, 'Content-Type': 'application/json; charset=UTF-8' } });
      if (r.data.error?.code && r.data.error.code !== 'ok') {
        const e = new Error(r.data.error.message || r.data.error.code); e.code = r.data.error.code; throw e;
      }
      return r.data.data;
    } catch (e) {
      if (retry && (e.code === 'access_token_invalid' || e.response?.status === 401) && row.page_access_token) {
        const r = await http.post('https://open.tiktokapis.com/v2/oauth/token/', new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY, client_secret: process.env.TIKTOK_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: row.page_access_token }).toString(), { timeout: 30000, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        if (!r.data.access_token) throw new Error('TikTok connection expired. Reconnect in Settings.');
        row.access_token = r.data.access_token;
        row.page_access_token = r.data.refresh_token || row.page_access_token;
        await pool.query('UPDATE social_accounts SET access_token=$1, page_access_token=$2, updated_at=NOW() WHERE id=$3', [row.access_token, row.page_access_token, row.id]);
        return call(path, payload, row, false);
      }
      throw new Error(e.response?.data?.error?.message || e.message);
    }
  }
  async function creator(row) { return call('post/publish/creator_info/query/', {}, row || await account()); }
  function validate(options, info) {
    if (!options || options.consent !== true) throw new Error('Review the video and accept TikTok posting consent.');
    if (!info.privacy_level_options?.includes(options.privacy)) throw new Error('Choose an available TikTok privacy setting.');
    if (!(options.duration > 0) || options.duration > info.max_video_post_duration_sec) throw new Error('Video duration is missing or exceeds the TikTok account limit.');
    if (options.branded && options.privacy === 'SELF_ONLY') throw new Error('Branded content cannot use Only me privacy.');
  }
  async function status(publishId, row) {
    const data = await call('post/publish/status/fetch/', { publish_id: publishId }, row || await account());
    return { platform: 'tiktok', publish_id: publishId, status: data.status,
      success: data.status === 'PUBLISH_COMPLETE', pending: !['PUBLISH_COMPLETE', 'FAILED'].includes(data.status),
      error: data.status === 'FAILED' ? data.fail_reason || 'TikTok publishing failed' : undefined,
      post_ids: data.publicaly_available_post_id || [] };
  }
  async function publish({ content, videoUrl, tiktok }, checkpoint = async () => {}) {
    const row = await account();
    const info = await creator(row);
    validate(tiktok, info);
    const url = new URL(videoUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com') throw new Error('Upload the TikTok video with the app video uploader first.');
    const video = await http.get(videoUrl, { responseType: 'arraybuffer', timeout: 120000, maxRedirects: 0, maxContentLength: 256 * 1024 * 1024 });
    const buffer = Buffer.from(video.data);
    if (!buffer.length) throw new Error('Video file is empty.');
    const chunkSize = buffer.length <= 64 * 1024 * 1024 ? buffer.length : 20 * 1024 * 1024;
    const count = Math.max(1, Math.floor(buffer.length / chunkSize));
    const init = await call('post/publish/video/init/', {
      post_info: { title: String(content || '').slice(0, 2200), privacy_level: tiktok.privacy,
        disable_comment: info.comment_disabled || !tiktok.comments, disable_duet: info.duet_disabled || !tiktok.duet,
        disable_stitch: info.stitch_disabled || !tiktok.stitch, brand_organic_toggle: !!tiktok.ownBrand,
        brand_content_toggle: !!tiktok.branded, is_aigc: !!tiktok.aiGenerated },
      source_info: { source: 'FILE_UPLOAD', video_size: buffer.length, chunk_size: chunkSize, total_chunk_count: count }
    }, row);
    if (!init?.publish_id || !init?.upload_url) throw new Error('TikTok did not return an upload session.');
    const pending = { platform: 'tiktok', success: false, pending: true, publish_id: init.publish_id, privacy: tiktok.privacy };
    await checkpoint(pending);
    try {
      for (let i = 0; i < count; i++) {
        const start = i * chunkSize, end = i === count - 1 ? buffer.length : start + chunkSize;
        await http.put(init.upload_url, buffer.subarray(start, end), { timeout: 120000, maxBodyLength: Infinity, headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${start}-${end - 1}/${buffer.length}`, 'Content-Length': end - start } });
      }
      return { ...await status(init.publish_id, row), privacy: tiktok.privacy };
    } catch (error) {
      // Keep the known session; never submit another copy to recover from an uncertain upload.
      return { ...pending, error: 'TikTok session awaiting confirmation: ' + error.message };
    }
  }
  return { creator, validate, publish, status };
}
module.exports = createTikTok;

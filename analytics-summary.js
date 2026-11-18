function summarizePosts(posts) {
  const platforms = {};
  const recentPublishedPosts = [];
  for (const post of posts) {
    const results = typeof post.results === 'string' ? JSON.parse(post.results) : post.results || {};
    const delivered = Object.keys(results).filter(key => results[key]?.success === true && !results[key].skipped);
    for (const platform of delivered) platforms[platform] = (platforms[platform] || 0) + 1;
    if (delivered.length && post.published_at) recentPublishedPosts.push({
      id: post.id, content: (post.content || '').substring(0, 100),
      publishedAt: post.published_at, platforms: delivered
    });
  }
  recentPublishedPosts.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return {
    overview: { totalPosts: posts.length, totalEngagement: null, totalFollowers: null, avgEngagementRate: null },
    platforms, recentPublishedPosts: recentPublishedPosts.slice(0, 3),
    metricsAvailable: false
  };
}
module.exports = summarizePosts;

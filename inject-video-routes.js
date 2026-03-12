const fs = require('fs');
const path = require('path');
const serverPath = 'C:/NNIT-Enterprise/social-automation/backend/server.js';
const content = fs.readFileSync(serverPath, 'utf8');
const newRoutes = `
// ================================================================
// MEDIA / VIDEO PROCESSING ROUTES (FFmpeg)
// ================================================================
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const multer = require('multer');
const os = require('os');
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, os.tmpdir()),
  filename: (req, file, cb) => cb(null, 'upload_' + Date.now() + path.extname(file.originalname))
});
const videoUpload = multer({ storage: videoStorage, limits: { fileSize: 500 * 1024 * 1024 } });
app.post('/api/media/trim', videoUpload.single('video'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No video file uploaded' });
    const { startTime, endTime, caption, captionPosition } = req.body;
    const start = parseFloat(startTime) || 0;
    const end = parseFloat(endTime) || 10;
    const duration = end - start;
    if (duration <= 0) return res.status(400).json({ error: 'Invalid trim times' });
    const inputPath = req.file.path;
    const outputPath = require('path').join(os.tmpdir(), 'trimmed_' + Date.now() + '.mp4');
    await new Promise((resolve, reject) => {
      let cmd = ffmpeg(inputPath).setStartTime(start).setDuration(duration).outputOptions(['-c:v libx264', '-c:a aac', '-movflags +faststart']);
      if (caption && caption.trim()) {
        const pos = captionPosition || 'bottom';
        const y = pos === 'top' ? '10' : pos === 'center' ? '(h-text_h)/2' : 'h-th-20';
        cmd = cmd.videoFilters(['drawtext=text=' + caption.replace(/'/g, "\\'") + ':fontsize=36:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=8:x=(w-text_w)/2:y=' + y]);
      }
      cmd.save(outputPath).on('end', resolve).on('error', reject);
    });
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="nnit-trimmed.mp4"');
    const stream = fs.createReadStream(outputPath);
    stream.pipe(res);
    stream.on('end', () => { fs.unlink(inputPath, () => {}); fs.unlink(outputPath, () => {}); });
  } catch (err) { res.status(500).json({ error: 'Video processing failed: ' + err.message }); }
});
app.post('/api/media/info', videoUpload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No video uploaded' });
  ffmpeg.ffprobe(req.file.path, (err, metadata) => {
    fs.unlink(req.file.path, () => {});
    if (err) return res.status(500).json({ error: err.message });
    const stream = metadata.streams.find(s => s.codec_type === 'video');
    res.json({ duration: metadata.format.duration, size: metadata.format.size, width: stream ? stream.width : null, height: stream ? stream.height : null, codec: stream ? stream.codec_name : null });
  });
});
`;
const marker = '// START SERVER';
if (!content.includes('/api/media/trim')) {
  const updated = content.replace(marker, newRoutes + '\n' + marker);
  fs.writeFileSync(serverPath, updated, 'utf8');
  console.log('Done! Video routes injected');
} else {
  console.log('Routes already exist');
}

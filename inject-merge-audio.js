const fs = require('fs');
const serverPath = 'C:/NNIT-Enterprise/social-automation/backend/server.js';
const content = fs.readFileSync(serverPath, 'utf8');
const newRoute = `
app.post('/api/media/merge-audio', videoUpload.fields([{ name: 'video', maxCount: 1 }, { name: 'audio', maxCount: 1 }]), async (req, res) => {
  try {
    if (!req.files || !req.files.video) return res.status(400).json({ error: 'No video file uploaded' });
    if (!req.files.audio) return res.status(400).json({ error: 'No audio file uploaded' });
    const videoPath = req.files.video[0].path;
    const audioPath = req.files.audio[0].path;
    const audioType = req.body.audioType || 'voiceover';
    const volume = parseFloat(req.body.volume || 100) / 100;
    const outputPath = require('path').join(os.tmpdir(), 'merged_' + Date.now() + '.mp4');
    await new Promise((resolve, reject) => {
      let cmd;
      if (audioType === 'music') {
        cmd = ffmpeg(videoPath).input(audioPath)
          .complexFilter(['[1:a]volume=' + volume + '[music]','[0:a][music]amix=inputs=2:duration=first[aout]'])
          .outputOptions(['-map 0:v', '-map [aout]', '-c:v copy', '-c:a aac', '-movflags +faststart']);
      } else {
        cmd = ffmpeg(videoPath).input(audioPath)
          .outputOptions(['-map 0:v', '-map 1:a', '-c:v copy', '-c:a aac', '-shortest', '-movflags +faststart']);
      }
      cmd.save(outputPath).on('end', resolve).on('error', reject);
    });
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="nnit-with-audio.mp4"');
    const stream = fs.createReadStream(outputPath);
    stream.pipe(res);
    stream.on('end', () => { fs.unlink(videoPath, () => {}); fs.unlink(audioPath, () => {}); fs.unlink(outputPath, () => {}); });
  } catch (err) {
    console.error('MERGE AUDIO ERROR:', err.message);
    res.status(500).json({ error: 'Audio merge failed: ' + err.message });
  }
});
`;
const marker = '// START SERVER';
if (!content.includes('/api/media/merge-audio')) {
  fs.writeFileSync(serverPath, content.replace(marker, newRoute + '\n' + marker), 'utf8');
  console.log('Done! merge-audio route injected');
} else { console.log('Route already exists'); }

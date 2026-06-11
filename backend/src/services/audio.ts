import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';

export function getAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        if (err.message.includes('Cannot find ffprobe')) {
          console.warn('[FFMPEG] ffprobe not found, falling back to file size estimation');
          try {
            const stats = fs.statSync(filePath);
            // Rough estimate assuming 64kbps average bitrate for compressed audio
            const estimated = (stats.size * 8) / (64 * 1024);
            return resolve(estimated);
          } catch {
            return resolve(0);
          }
        }
        return reject(err);
      }
      resolve(metadata.format.duration || 0);
    });
  });
}

export function detectSilenceRatio(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let silenceDuration = 0;
    let totalDuration = 0;

    ffmpeg(filePath)
      .audioFilters('silencedetect=noise=-50dB:d=0.5')
      .on('codecData', (data) => {
        const parts = data.duration.split(':');
        totalDuration =
          parseFloat(parts[0]) * 3600 +
          parseFloat(parts[1]) * 60 +
          parseFloat(parts[2]);
      })
      .on('stderr', (line: string) => {
        const startMatch = line.match(/silence_start: ([\d.]+)/);
        const endMatch = line.match(/silence_end: ([\d.]+)/);
        if (startMatch && endMatch) {
          silenceDuration += parseFloat(endMatch[1]) - parseFloat(startMatch[1]);
        }
      })
      .on('end', () => {
        resolve(totalDuration > 0 ? silenceDuration / totalDuration : 0);
      })
      .on('error', (err) => {
        if (err.message.includes('Cannot find ffmpeg')) {
          console.warn('[FFMPEG] ffmpeg not found, skipping silence detection');
          return resolve(0);
        }
        reject(err);
      })
      .format('null')
      .save('/dev/null');
  });
}

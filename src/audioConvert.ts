import { spawn } from 'node:child_process';

// Converting recordings with ffmpeg (which must be installed: on Heroku, add
// an ffmpeg buildpack). FFMPEG_PATH may point at it; otherwise `ffmpeg` is
// looked up on the PATH.

// `audio` (any format ffmpeg reads, e.g. a WebM recording) as a 16 kHz mono
// 16-bit WAV, the format Azure's speech REST API takes.
export function toWav16kMono(audio: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const ffmpeg = spawn(
            process.env['FFMPEG_PATH'] || 'ffmpeg',
            ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1'],
            { stdio: ['pipe', 'pipe', 'pipe'] },
        );
        const out: Buffer[] = [];
        const err: Buffer[] = [];
        ffmpeg.stdout.on('data', (chunk: Buffer) => out.push(chunk));
        ffmpeg.stderr.on('data', (chunk: Buffer) => err.push(chunk));
        ffmpeg.on('error', (e: NodeJS.ErrnoException) =>
            reject(e.code === 'ENOENT' ? new Error('ffmpeg is not installed on the server (needed to convert the recording for Azure).') : e),
        );
        ffmpeg.on('close', (code) => {
            if (code === 0) resolve(Buffer.concat(out));
            else reject(new Error(`ffmpeg could not convert the recording: ${Buffer.concat(err).toString().trim().slice(0, 300) || `exit code ${code}`}`));
        });
        // ffmpeg may stop reading early on bad input; that's reported by 'close'.
        ffmpeg.stdin.on('error', () => {});
        ffmpeg.stdin.end(audio);
    });
}

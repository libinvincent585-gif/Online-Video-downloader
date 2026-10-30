import express from 'express';
import type { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const execFileAsync = promisify(execFile);

async function fetchFreeGateway<T>(endpoint: string, targetUrl: string): Promise<T | null> {
  try {
    const apiUrl = `https://backend1.tioo.eu.org/api/downloader/${endpoint}?url=${encodeURIComponent(targetUrl)}`;
    const resp = await fetch(apiUrl, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'btch/2.0.0',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    return (await resp.json()) as T;
  } catch {
    return null;
  }
}

const abDownloader = {
  youtube: async (url: string) =>
    fetchFreeGateway<{
      status?: boolean;
      title?: string;
      thumbnail?: string;
      author?: string;
      mp3?: string;
      mp4?: string;
    }>('youtube', url),
  igdl: async (url: string) =>
    fetchFreeGateway<
      | Array<{ thumbnail?: string; url?: string; resolution?: string }>
      | { status?: boolean; msg?: string }
    >('igdl', url),
  fbdown: async (url: string) =>
    fetchFreeGateway<{
      status?: boolean;
      Normal_video?: string;
      HD?: string;
    }>('fbdown', url),
  tiktok: async (url: string) => {
    const raw = await fetchFreeGateway<{
      data?: {
        title?: string;
        author?: { nickname?: string };
        cover?: string;
        play?: string;
        wmplay?: string;
        hdplay?: string;
        music_info?: { play?: string };
      };
    }>('tiktok', url);
    const d = raw?.data;
    if (!d) return null;
    return {
      title: d.title,
      author: d.author?.nickname,
      cover: d.cover,
      play: d.play,
      wmplay: d.wmplay,
      hdplay: d.hdplay,
      music: d.music_info?.play,
    };
  },
  twitter: async (url: string) =>
    fetchFreeGateway<{
      status?: boolean;
      title?: string;
      url?: string | Array<{ hd?: string; sd?: string; url?: string }>;
    }>('twitter', url),
  aio: async (url: string) =>
    fetchFreeGateway<{
      status?: boolean;
      url?: string;
    }>('aio', url),
};

interface SourceStream {
  url: string;
  height?: number;
  hasVideo: boolean;
  hasAudio: boolean;
  ext: string;
  sizeBytes?: number;
  bitrate?: number;
  headers?: Record<string, string>;
}

interface FormatSpec {
  id: string;
  category: 'video' | 'video_only' | 'music';
  container: 'MP4' | '3GP' | 'MP3';
  qualityLabel: string;
  subLabel?: string;
  targetHeight?: number;
  audioKbps?: number;
  sizeBytes: number;
  sizeFormatted: string;
  fast?: boolean;
  primary?: boolean;
}

interface MediaJob {
  jobId: string;
  createdAt: number;
  title: string;
  author: string;
  platform: string;
  durationSeconds: number;
  thumbnailUrl: string;
  sourceUrl: string;
  bestCombinedUrl: string;
  bestVideoOnlyUrl?: string;
  bestAudioUrl?: string;
  requestHeaders?: Record<string, string>;
  streams: SourceStream[];
  formats: FormatSpec[];
  cachedVideoPath?: string;
  cachedAudioPath?: string;
  probedHeight?: number;
}

const jobs = new Map<string, MediaJob>();
const inFlightDownloads = new Map<string, Promise<string>>();

// Clean up expired jobs and cached temp files older than 45 minutes
setInterval(() => {
  const cutoff = Date.now() - 45 * 60 * 1000;
  for (const [id, job] of jobs.entries()) {
    if (job.createdAt < cutoff) {
      for (const p of [job.cachedVideoPath, job.cachedAudioPath]) {
        if (p && fs.existsSync(p)) {
          try {
            fs.unlinkSync(p);
          } catch {
            // ignore
          }
        }
      }
      jobs.delete(id);
    }
  }
}, 10 * 60 * 1000).unref();

const YT_DLP_PATH = path.resolve(process.cwd(), 'bin', 'yt-dlp');

async function ensureYtDlp(): Promise<string | null> {
  try {
    if (fs.existsSync(YT_DLP_PATH)) {
      return YT_DLP_PATH;
    }
    fs.mkdirSync(path.dirname(YT_DLP_PATH), { recursive: true });
    const arch = os.arch() === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
    const resp = await fetch(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${arch}`, {
      signal: AbortSignal.timeout(25000),
    });
    if (!resp.ok || !resp.body) return null;
    const fileStream = fs.createWriteStream(YT_DLP_PATH, { mode: 0o755 });
    await pipeline(Readable.fromWeb(resp.body as never), fileStream);
    fs.chmodSync(YT_DLP_PATH, 0o755);
    return YT_DLP_PATH;
  } catch {
    return null;
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '2.40 MB';
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(sec: number): string {
  const total = Math.max(1, Math.round(sec || 60));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function sanitizeFilename(title: string): string {
  const cleaned = title
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || 'video_download';
}

function detectPlatform(rawUrl: string): string {
  const u = rawUrl.toLowerCase();
  if (u.includes('youtube.com/shorts')) return 'YouTube Shorts';
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'YouTube';
  if (u.includes('instagram.com') || u.includes('instagr.am')) return 'Instagram';
  if (u.includes('tiktok.com')) return 'TikTok';
  if (u.includes('facebook.com') || u.includes('fb.watch')) return 'Facebook';
  if (u.includes('twitter.com') || u.includes('x.com')) return 'X (Twitter)';
  if (u.includes('threads.net')) return 'Threads';
  if (u.includes('reddit.com') || u.includes('redd.it')) return 'Reddit';
  return 'Web Media';
}

function extractYouTubeId(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.replace(/^www\./, '').replace(/^m\./, '');
    if (host === 'youtu.be') {
      const id = parsed.pathname.split('/').filter(Boolean)[0];
      return id && id.length >= 10 ? id : null;
    }
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = parsed.searchParams.get('v');
      if (v) return v;
      const parts = parsed.pathname.split('/').filter(Boolean);
      if ((parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live' || parts[0] === 'v') && parts[1]) {
        return parts[1];
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function parseStreamUrlMetadata(streamUrl: string): { durationSec?: number; clen?: number } {
  try {
    const decoded = decodeURIComponent(streamUrl);
    const durMatch = decoded.match(/[?&]dur=([0-9.]+)/);
    const clenMatch = decoded.match(/[?&]clen=(\d+)/);
    return {
      durationSec: durMatch ? Math.round(parseFloat(durMatch[1])) : undefined,
      clen: clenMatch ? parseInt(clenMatch[1], 10) : undefined,
    };
  } catch {
    return {};
  }
}

function buildFormatsForDuration(durationSec: number, streams: SourceStream[]): FormatSpec[] {
  const dur = Math.max(5, durationSec || 60);

  const findExactSize = (height: number, videoOnly: boolean): number | undefined => {
    const match = streams.find(
      (s) => s.height === height && s.hasVideo && (videoOnly ? !s.hasAudio : s.hasAudio) && s.sizeBytes && s.sizeBytes > 10000
    );
    return match?.sizeBytes;
  };

  const estVideoBytes = (kbps: number) => Math.round((kbps * 1000 * dur) / 8);

  return [
    // Video + Audio (MP4 & 3GP)
    {
      id: 'mp4_360p',
      category: 'video',
      container: 'MP4',
      qualityLabel: '360P',
      targetHeight: 360,
      sizeBytes: findExactSize(360, false) ?? estVideoBytes(520),
      sizeFormatted: formatBytes(findExactSize(360, false) ?? estVideoBytes(520)),
      fast: true,
      primary: true,
    },
    {
      id: 'mp4_720p',
      category: 'video',
      container: 'MP4',
      qualityLabel: '720P',
      subLabel: 'HD',
      targetHeight: 720,
      sizeBytes: findExactSize(720, false) ?? estVideoBytes(1450),
      sizeFormatted: formatBytes(findExactSize(720, false) ?? estVideoBytes(1450)),
      fast: true,
      primary: true,
    },
    {
      id: 'mp4_1080p',
      category: 'video',
      container: 'MP4',
      qualityLabel: '1080P',
      subLabel: 'Full HD',
      targetHeight: 1080,
      sizeBytes: findExactSize(1080, false) ?? estVideoBytes(2650),
      sizeFormatted: formatBytes(findExactSize(1080, false) ?? estVideoBytes(2650)),
      fast: true,
      primary: true,
    },
    {
      id: '3gp_240p',
      category: 'video',
      container: '3GP',
      qualityLabel: '240P',
      subLabel: '3GP Mobile',
      targetHeight: 240,
      sizeBytes: estVideoBytes(210),
      sizeFormatted: formatBytes(estVideoBytes(210)),
      primary: true,
    },
    {
      id: 'mp4_480p',
      category: 'video',
      container: 'MP4',
      qualityLabel: '480P',
      targetHeight: 480,
      sizeBytes: findExactSize(480, false) ?? estVideoBytes(820),
      sizeFormatted: formatBytes(findExactSize(480, false) ?? estVideoBytes(820)),
      primary: true,
    },
    {
      id: 'mp4_240p',
      category: 'video',
      container: 'MP4',
      qualityLabel: '240P',
      targetHeight: 240,
      sizeBytes: findExactSize(240, false) ?? estVideoBytes(260),
      sizeFormatted: formatBytes(findExactSize(240, false) ?? estVideoBytes(260)),
      primary: false,
    },
    {
      id: 'mp4_144p',
      category: 'video',
      container: 'MP4',
      qualityLabel: '144P',
      targetHeight: 144,
      sizeBytes: findExactSize(144, false) ?? estVideoBytes(125),
      sizeFormatted: formatBytes(findExactSize(144, false) ?? estVideoBytes(125)),
      primary: false,
    },
    {
      id: '3gp_144p',
      category: 'video',
      container: '3GP',
      qualityLabel: '144P',
      subLabel: '3GP Saver',
      targetHeight: 144,
      sizeBytes: estVideoBytes(95),
      sizeFormatted: formatBytes(estVideoBytes(95)),
      primary: false,
    },

    // Video Only (Muted / No Audio)
    {
      id: 'vo_1080p',
      category: 'video_only',
      container: 'MP4',
      qualityLabel: '1080P',
      subLabel: 'Video Only · Muted',
      targetHeight: 1080,
      sizeBytes: findExactSize(1080, true) ?? estVideoBytes(2200),
      sizeFormatted: formatBytes(findExactSize(1080, true) ?? estVideoBytes(2200)),
      fast: true,
      primary: true,
    },
    {
      id: 'vo_720p',
      category: 'video_only',
      container: 'MP4',
      qualityLabel: '720P',
      subLabel: 'Video Only · Muted',
      targetHeight: 720,
      sizeBytes: findExactSize(720, true) ?? estVideoBytes(1200),
      sizeFormatted: formatBytes(findExactSize(720, true) ?? estVideoBytes(1200)),
      fast: true,
      primary: true,
    },
    {
      id: 'vo_360p',
      category: 'video_only',
      container: 'MP4',
      qualityLabel: '360P',
      subLabel: 'Video Only · Muted',
      targetHeight: 360,
      sizeBytes: findExactSize(360, true) ?? estVideoBytes(410),
      sizeFormatted: formatBytes(findExactSize(360, true) ?? estVideoBytes(410)),
      fast: true,
      primary: true,
    },
    {
      id: 'vo_480p',
      category: 'video_only',
      container: 'MP4',
      qualityLabel: '480P',
      subLabel: 'Video Only · Muted',
      targetHeight: 480,
      sizeBytes: findExactSize(480, true) ?? estVideoBytes(690),
      sizeFormatted: formatBytes(findExactSize(480, true) ?? estVideoBytes(690)),
      primary: false,
    },

    // Music Only (MP3 Audio)
    {
      id: 'mp3_48k',
      category: 'music',
      container: 'MP3',
      qualityLabel: '48KBPS',
      audioKbps: 48,
      sizeBytes: estVideoBytes(48),
      sizeFormatted: formatBytes(estVideoBytes(48)),
      primary: true,
    },
    {
      id: 'mp3_128k',
      category: 'music',
      container: 'MP3',
      qualityLabel: '128KBPS',
      audioKbps: 128,
      sizeBytes: estVideoBytes(128),
      sizeFormatted: formatBytes(estVideoBytes(128)),
      fast: true,
      primary: true,
    },
    {
      id: 'mp3_256k',
      category: 'music',
      container: 'MP3',
      qualityLabel: '256KBPS',
      audioKbps: 256,
      sizeBytes: estVideoBytes(256),
      sizeFormatted: formatBytes(estVideoBytes(256)),
      primary: true,
    },
    {
      id: 'mp3_320k',
      category: 'music',
      container: 'MP3',
      qualityLabel: '320KBPS',
      subLabel: 'HQ',
      audioKbps: 320,
      sizeBytes: estVideoBytes(320),
      sizeFormatted: formatBytes(estVideoBytes(320)),
      primary: false,
    },
  ];
}

// Primary Direct Multi-Resolution Free API (144p, 240p, 360p, 480p, 720p, 1080p native H.264 + M4A audio)
async function extractYouTubeViaVidSnap(videoId: string, originalUrl: string): Promise<MediaJob | null> {
  try {
    const resp = await fetch(`https://api.vidsnap.app/parse?id=${encodeURIComponent(videoId)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      title?: string;
      author?: string;
      lengthSeconds?: number;
      thumbnails?: Array<{ url?: string; width?: number }>;
      formats?: Array<{
        itag?: string | number;
        kind?: 'progressive' | 'video' | 'audio';
        qualityLabel?: string;
        mimeType?: string;
        url?: string;
        bitrate?: number;
        contentLength?: string | number;
      }>;
    };

    if (!data.formats || data.formats.length === 0) return null;

    const toProxy = (u: string) =>
      u.includes('api.vidsnap.app/proxy')
        ? u
        : `https://api.vidsnap.app/proxy?u=${encodeURIComponent(u)}`;

    const durationSec = Math.max(1, Number(data.lengthSeconds) || 60);
    const streams: SourceStream[] = [];

    for (const f of data.formats) {
      if (!f.url) continue;
      const mime = (f.mimeType || '').toLowerCase();
      // Prefer H.264 (avc1) MP4 video and mp4a M4A audio for instant lossless FFmpeg muxing
      const isMp4Video = mime.includes('video/mp4') && (!mime.includes('av01') || f.kind === 'progressive');
      const isMp4Audio = mime.includes('audio/mp4');
      const isWebmAudio = mime.includes('audio/webm');

      const parsedH = parseInt(String(f.qualityLabel || '').replace(/\D/g, ''), 10) || undefined;
      const clen = f.contentLength
        ? Number(f.contentLength)
        : parseStreamUrlMetadata(f.url).clen ||
          (f.bitrate ? Math.round((f.bitrate * durationSec) / 8) : undefined);

      if (f.kind === 'progressive' && mime.includes('video/mp4')) {
        streams.push({
          url: toProxy(f.url),
          height: parsedH || 360,
          hasVideo: true,
          hasAudio: true,
          ext: 'mp4',
          sizeBytes: clen,
          bitrate: f.bitrate,
        });
      } else if (f.kind === 'video' && isMp4Video && parsedH) {
        streams.push({
          url: toProxy(f.url),
          height: parsedH,
          hasVideo: true,
          hasAudio: false,
          ext: 'mp4',
          sizeBytes: clen,
          bitrate: f.bitrate,
        });
      } else if (f.kind === 'audio' && (isMp4Audio || isWebmAudio)) {
        streams.push({
          url: toProxy(f.url),
          hasVideo: false,
          hasAudio: true,
          ext: isMp4Audio ? 'm4a' : 'webm',
          sizeBytes: clen,
          bitrate: f.bitrate,
        });
      }
    }

    const progressive = streams.filter((s) => s.hasVideo && s.hasAudio).sort((a, b) => (b.height || 0) - (a.height || 0));
    const videoOnly = streams.filter((s) => s.hasVideo && !s.hasAudio).sort((a, b) => (b.height || 0) - (a.height || 0));
    const m4aAudios = streams.filter((s) => !s.hasVideo && s.hasAudio && s.ext === 'm4a').sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    const anyAudios = streams.filter((s) => !s.hasVideo && s.hasAudio).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

    const bestCombined = progressive[0]?.url || videoOnly[0]?.url;
    if (!bestCombined) return null;

    const bestThumb =
      data.thumbnails?.slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url ||
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    const jobId = crypto.randomUUID();
    return {
      jobId,
      createdAt: Date.now(),
      title: data.title || 'YouTube Video',
      author: data.author || 'YouTube Creator',
      platform: detectPlatform(originalUrl),
      durationSeconds: durationSec,
      thumbnailUrl: bestThumb,
      sourceUrl: originalUrl,
      bestCombinedUrl: bestCombined,
      bestVideoOnlyUrl: videoOnly[0]?.url,
      bestAudioUrl: m4aAudios[0]?.url || anyAudios[0]?.url,
      streams,
      formats: buildFormatsForDuration(durationSec, streams),
    };
  } catch {
    return null;
  }
}

// Secondary Free Keyless API for YouTube & Shorts (ab-downloader)
async function extractYouTubeViaFreeApi(videoId: string, originalUrl: string): Promise<MediaJob | null> {
  try {
    const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const res = await abDownloader.youtube(canonicalUrl);
    if (!res || res.status === false || (!res.mp4 && !res.mp3)) {
      return null;
    }

    const metaMp4 = res.mp4 ? parseStreamUrlMetadata(res.mp4) : {};
    const metaMp3 = res.mp3 ? parseStreamUrlMetadata(res.mp3) : {};
    const durationSec = metaMp4.durationSec || metaMp3.durationSec || 60;

    const streams: SourceStream[] = [];
    if (res.mp4) {
      streams.push({
        url: res.mp4,
        height: 360,
        hasVideo: true,
        hasAudio: true,
        ext: 'mp4',
        sizeBytes: metaMp4.clen,
      });
    }
    if (res.mp3) {
      streams.push({
        url: res.mp3,
        hasVideo: false,
        hasAudio: true,
        ext: 'webm',
        sizeBytes: metaMp3.clen,
      });
    }

    const bestCombined = res.mp4 || res.mp3!;
    const jobId = crypto.randomUUID();

    return {
      jobId,
      createdAt: Date.now(),
      title: res.title || 'YouTube Video',
      author: res.author || 'YouTube Creator',
      platform: detectPlatform(originalUrl),
      durationSeconds: durationSec,
      thumbnailUrl: res.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      sourceUrl: originalUrl,
      bestCombinedUrl: bestCombined,
      bestAudioUrl: res.mp3,
      streams,
      formats: buildFormatsForDuration(durationSec, streams),
    };
  } catch {
    return null;
  }
}

async function extractYouTubeViaPiped(videoId: string, originalUrl: string): Promise<MediaJob | null> {
  const pipedInstances = [
    'https://api.piped.private.coffee',
    'https://pipedapi.kavin.rocks',
    'https://pipedapi-libre.kavin.rocks',
    'https://pipedapi.leptons.xyz',
    'https://pipedapi.drgns.space',
  ];

  for (const base of pipedInstances) {
    try {
      const resp = await fetch(`${base}/streams/${encodeURIComponent(videoId)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) continue;
      const data = (await resp.json()) as {
        title?: string;
        uploader?: string;
        duration?: number;
        thumbnailUrl?: string;
        videoStreams?: Array<{
          url?: string;
          quality?: string;
          format?: string;
          videoOnly?: boolean;
          height?: number;
          contentLength?: number;
          bitrate?: number;
        }>;
        audioStreams?: Array<{
          url?: string;
          quality?: string;
          format?: string;
          contentLength?: number;
          bitrate?: number;
        }>;
      };

      const validVideoStreams: SourceStream[] = [];
      for (const vs of data.videoStreams ?? []) {
        const qUpper = String(vs.quality || '').toUpperCase();
        if (!vs.url || qUpper.includes('LBRY') || vs.url.includes('odycdn.com') || String(vs.format || '').toUpperCase() === 'HLS') {
          continue;
        }
        const parsedH = vs.height || parseInt(qUpper.replace(/\D/g, ''), 10) || 360;
        validVideoStreams.push({
          url: vs.url,
          height: parsedH,
          hasVideo: true,
          hasAudio: !vs.videoOnly,
          ext: (vs.format || 'mp4').toLowerCase().includes('webm') ? 'webm' : 'mp4',
          sizeBytes: vs.contentLength && vs.contentLength > 0 ? vs.contentLength : undefined,
          bitrate: vs.bitrate,
        });
      }

      const validAudioStreams: SourceStream[] = [];
      for (const as of data.audioStreams ?? []) {
        if (!as.url || as.url.includes('odycdn.com')) continue;
        validAudioStreams.push({
          url: as.url,
          hasVideo: false,
          hasAudio: true,
          ext: 'm4a',
          sizeBytes: as.contentLength && as.contentLength > 0 ? as.contentLength : undefined,
          bitrate: as.bitrate,
        });
      }

      const combined = validVideoStreams
        .filter((s) => s.hasAudio)
        .sort((a, b) => (b.height || 0) - (a.height || 0));

      const videoOnly = validVideoStreams
        .filter((s) => !s.hasAudio)
        .sort((a, b) => (b.height || 0) - (a.height || 0));

      const bestCombined = combined[0]?.url || validVideoStreams[0]?.url;
      if (!bestCombined) continue;

      const allStreams = [...validVideoStreams, ...validAudioStreams];
      const durationSec = data.duration || 60;
      const jobId = crypto.randomUUID();

      return {
        jobId,
        createdAt: Date.now(),
        title: data.title || 'YouTube Video',
        author: data.uploader || 'YouTube Creator',
        platform: detectPlatform(originalUrl),
        durationSeconds: durationSec,
        thumbnailUrl: data.thumbnailUrl || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        sourceUrl: originalUrl,
        bestCombinedUrl: bestCombined,
        bestVideoOnlyUrl: videoOnly[0]?.url,
        bestAudioUrl: validAudioStreams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0]?.url,
        streams: allStreams,
        formats: buildFormatsForDuration(durationSec, allStreams),
      };
    } catch {
      continue;
    }
  }
  return null;
}

async function extractTikTok(rawUrl: string): Promise<MediaJob | null> {
  // Engine 1: TikWM free API
  try {
    const resp = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(rawUrl)}&hd=1`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(9000),
    });
    if (resp.ok) {
      const json = (await resp.json()) as {
        code?: number;
        data?: {
          title?: string;
          duration?: number;
          cover?: string;
          origin_cover?: string;
          play?: string;
          hdplay?: string;
          wmplay?: string;
          music?: string;
          size?: number;
          hd_size?: number;
          author?: { nickname?: string; unique_id?: string };
        };
      };
      if (json.code === 0 && json.data) {
        const d = json.data;
        const videoUrl = d.hdplay || d.play || d.wmplay;
        if (videoUrl) {
          const streams: SourceStream[] = [];
          if (d.hdplay) {
            streams.push({ url: d.hdplay, height: 1080, hasVideo: true, hasAudio: true, ext: 'mp4', sizeBytes: d.hd_size });
          }
          if (d.play) {
            streams.push({ url: d.play, height: 720, hasVideo: true, hasAudio: true, ext: 'mp4', sizeBytes: d.size });
          }
          if (d.music) {
            streams.push({ url: d.music, hasVideo: false, hasAudio: true, ext: 'mp3' });
          }

          const durationSec = d.duration || 30;
          const jobId = crypto.randomUUID();
          return {
            jobId,
            createdAt: Date.now(),
            title: d.title || 'TikTok Video',
            author: d.author?.nickname || d.author?.unique_id || 'TikTok Creator',
            platform: 'TikTok',
            durationSeconds: durationSec,
            thumbnailUrl: d.origin_cover || d.cover || '',
            sourceUrl: rawUrl,
            bestCombinedUrl: videoUrl,
            bestAudioUrl: d.music,
            streams,
            formats: buildFormatsForDuration(durationSec, streams),
          };
        }
      }
    }
  } catch {
    // fallback to ab-downloader
  }

  // Engine 2: ab-downloader tiktok
  try {
    const res = await abDownloader.tiktok(rawUrl);
    const videoUrl = res?.hdplay || res?.play || res?.wmplay;
    if (videoUrl) {
      const streams: SourceStream[] = [{ url: videoUrl, height: 720, hasVideo: true, hasAudio: true, ext: 'mp4' }];
      const jobId = crypto.randomUUID();
      return {
        jobId,
        createdAt: Date.now(),
        title: res.title || 'TikTok Video',
        author: res.author || 'TikTok Creator',
        platform: 'TikTok',
        durationSeconds: 30,
        thumbnailUrl: res.cover || '',
        sourceUrl: rawUrl,
        bestCombinedUrl: videoUrl,
        bestAudioUrl: res.music,
        streams,
        formats: buildFormatsForDuration(30, streams),
      };
    }
  } catch {
    // ignore
  }

  return null;
}

async function extractFacebook(rawUrl: string): Promise<MediaJob | null> {
  try {
    const res = await abDownloader.fbdown(rawUrl);
    const best = res?.HD || res?.Normal_video;
    if (best) {
      const streams: SourceStream[] = [];
      if (res.HD) streams.push({ url: res.HD, height: 720, hasVideo: true, hasAudio: true, ext: 'mp4' });
      if (res.Normal_video) streams.push({ url: res.Normal_video, height: 360, hasVideo: true, hasAudio: true, ext: 'mp4' });
      const jobId = crypto.randomUUID();
      return {
        jobId,
        createdAt: Date.now(),
        title: 'Facebook Video',
        author: 'Facebook',
        platform: 'Facebook',
        durationSeconds: 45,
        thumbnailUrl: '',
        sourceUrl: rawUrl,
        bestCombinedUrl: best,
        streams,
        formats: buildFormatsForDuration(45, streams),
      };
    }
  } catch {
    // ignore
  }

  return null;
}

async function extractInstagram(rawUrl: string): Promise<MediaJob | null> {
  // Strategy 1: Free keyless IG API
  try {
    const igRes = await abDownloader.igdl(rawUrl);
    if (Array.isArray(igRes) && igRes.length > 0 && igRes[0]?.url) {
      const vidUrl = igRes[0].url;
      const streams: SourceStream[] = [{ url: vidUrl, height: 1080, hasVideo: true, hasAudio: true, ext: 'mp4' }];
      const jobId = crypto.randomUUID();
      return {
        jobId,
        createdAt: Date.now(),
        title: 'Instagram Reel / Video',
        author: 'Instagram',
        platform: 'Instagram',
        durationSeconds: 30,
        thumbnailUrl: igRes[0].thumbnail || '',
        sourceUrl: rawUrl,
        bestCombinedUrl: vidUrl,
        streams,
        formats: buildFormatsForDuration(30, streams),
      };
    }
  } catch {
    // continue
  }

  // Strategy 3: Instagram embed page HTML extraction
  try {
    const parsed = new URL(rawUrl);
    const m = parsed.pathname.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
    if (m) {
      const shortcode = m[1];
      const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
      const resp = await fetch(embedUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(9000),
      });

      if (resp.ok) {
        const html = await resp.text();
        const videoMatch =
          html.match(/"video_url"\s*:\s*"([^"]+)"/) ||
          html.match(/video_url\\"\s*:\s*\\"([^\\"]+)\\"/) ||
          html.match(/property="og:video"\s+content="([^"]+)"/);

        if (videoMatch?.[1]) {
          const cleanVideoUrl = videoMatch[1]
            .replace(/\\u0026/g, '&')
            .replace(/\\\//g, '/')
            .replace(/&amp;/g, '&');

          const thumbMatch =
            html.match(/"display_url"\s*:\s*"([^"]+)"/) ||
            html.match(/display_url\\"\s*:\s*\\"([^\\"]+)\\"/) ||
            html.match(/class="EmbeddedMediaImage"[^>]+src="([^"]+)"/);

          const cleanThumb = thumbMatch?.[1]
            ? thumbMatch[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/&amp;/g, '&')
            : '';

          const streams: SourceStream[] = [
            { url: cleanVideoUrl, height: 1080, hasVideo: true, hasAudio: true, ext: 'mp4' },
          ];
          const jobId = crypto.randomUUID();
          return {
            jobId,
            createdAt: Date.now(),
            title: `Instagram Video (${shortcode})`,
            author: 'Instagram Creator',
            platform: 'Instagram',
            durationSeconds: 30,
            thumbnailUrl: cleanThumb,
            sourceUrl: rawUrl,
            bestCombinedUrl: cleanVideoUrl,
            streams,
            formats: buildFormatsForDuration(30, streams),
          };
        }
      }
    }
  } catch {
    // ignore
  }
  return null;
}

async function extractTwitterX(rawUrl: string): Promise<MediaJob | null> {
  try {
    const parsed = new URL(rawUrl);
    const m = parsed.pathname.match(/\/([^/]+)\/status\/(\d+)/);
    if (m) {
      const [, user, statusId] = m;
      const resp = await fetch(`https://api.fxtwitter.com/${user}/status/${statusId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8000),
      });
      if (resp.ok) {
        const data = (await resp.json()) as {
          tweet?: {
            text?: string;
            author?: { name?: string; screen_name?: string };
            media?: {
              videos?: Array<{
                url?: string;
                thumbnail_url?: string;
                duration?: number;
                variants?: Array<{ url?: string; bitrate?: number; content_type?: string }>;
              }>;
            };
          };
        };
        const vid = data.tweet?.media?.videos?.[0];
        if (vid?.url) {
          const streams: SourceStream[] = (vid.variants || [])
            .filter((v) => v.url && v.content_type?.includes('mp4'))
            .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
            .map((v, idx) => ({
              url: v.url!,
              height: idx === 0 ? 1080 : idx === 1 ? 720 : 360,
              hasVideo: true,
              hasAudio: true,
              ext: 'mp4',
              bitrate: v.bitrate,
            }));

          if (streams.length === 0) {
            streams.push({ url: vid.url, height: 720, hasVideo: true, hasAudio: true, ext: 'mp4' });
          }

          const durationSec = Math.round(vid.duration || 30);
          const jobId = crypto.randomUUID();
          return {
            jobId,
            createdAt: Date.now(),
            title: data.tweet?.text?.slice(0, 90) || 'X Video',
            author: data.tweet?.author?.name || user,
            platform: 'X (Twitter)',
            durationSeconds: durationSec,
            thumbnailUrl: vid.thumbnail_url || '',
            sourceUrl: rawUrl,
            bestCombinedUrl: streams[0].url,
            streams,
            formats: buildFormatsForDuration(durationSec, streams),
          };
        }
      }
    }
  } catch {
    // fallback to ab-downloader twitter
  }

  try {
    const res = await abDownloader.twitter(rawUrl);
    const directUrl =
      typeof res?.url === 'string'
        ? res.url
        : Array.isArray(res?.url)
        ? res.url[0]?.hd || res.url[0]?.sd || res.url[0]?.url
        : undefined;
    if (directUrl) {
      const streams: SourceStream[] = [{ url: directUrl, height: 720, hasVideo: true, hasAudio: true, ext: 'mp4' }];
      const jobId = crypto.randomUUID();
      return {
        jobId,
        createdAt: Date.now(),
        title: res?.title || 'X Video',
        author: 'X Creator',
        platform: 'X (Twitter)',
        durationSeconds: 30,
        thumbnailUrl: '',
        sourceUrl: rawUrl,
        bestCombinedUrl: directUrl,
        streams,
        formats: buildFormatsForDuration(30, streams),
      };
    }
  } catch {
    // ignore
  }
  return null;
}

async function extractDirectOrOpenGraph(rawUrl: string): Promise<MediaJob | null> {
  try {
    const headResp = await fetch(rawUrl, {
      method: 'HEAD',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(6000),
    });
    const ct = (headResp.headers.get('content-type') || '').toLowerCase();
    const cl = parseInt(headResp.headers.get('content-length') || '0', 10);

    if (ct.startsWith('video/') || ct.startsWith('audio/') || /\.(mp4|webm|mov|m4v|mp3)(\?|$)/i.test(rawUrl)) {
      const parsed = new URL(rawUrl);
      const rawName = decodeURIComponent(path.basename(parsed.pathname) || 'Direct Media');
      const title = rawName.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ') || 'Direct Video';
      const streams: SourceStream[] = [
        {
          url: rawUrl,
          height: 1080,
          hasVideo: !ct.startsWith('audio/'),
          hasAudio: true,
          ext: ct.startsWith('audio/') ? 'mp3' : 'mp4',
          sizeBytes: cl > 0 ? cl : undefined,
        },
      ];
      const estDur = cl > 0 ? Math.max(10, Math.round(cl / (180 * 1024))) : 45;
      const jobId = crypto.randomUUID();
      return {
        jobId,
        createdAt: Date.now(),
        title,
        author: parsed.hostname.replace(/^www\./, ''),
        platform: detectPlatform(rawUrl),
        durationSeconds: estDur,
        thumbnailUrl: '',
        sourceUrl: rawUrl,
        bestCombinedUrl: rawUrl,
        streams,
        formats: buildFormatsForDuration(estDur, streams),
      };
    }

    const pageResp = await fetch(rawUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
      },
      signal: AbortSignal.timeout(7000),
    });
    if (pageResp.ok) {
      const html = await pageResp.text();
      const ogVideo =
        html.match(/<meta[^>]+property=["']og:video(?::secure_url|:url)?["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video(?::secure_url|:url)?["']/i)?.[1];
      if (ogVideo && ogVideo.startsWith('http')) {
        const cleanUrl = ogVideo.replace(/&amp;/g, '&');
        const ogTitle =
          html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
          'Social Video';
        const ogImage =
          html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] || '';

        const streams: SourceStream[] = [
          { url: cleanUrl, height: 720, hasVideo: true, hasAudio: true, ext: 'mp4' },
        ];
        const jobId = crypto.randomUUID();
        return {
          jobId,
          createdAt: Date.now(),
          title: ogTitle.replace(/&amp;/g, '&').slice(0, 90),
          author: detectPlatform(rawUrl),
          platform: detectPlatform(rawUrl),
          durationSeconds: 45,
          thumbnailUrl: ogImage.replace(/&amp;/g, '&'),
          sourceUrl: rawUrl,
          bestCombinedUrl: cleanUrl,
          streams,
          formats: buildFormatsForDuration(45, streams),
        };
      }
    }
  } catch {
    // ignore
  }
  return null;
}

async function extractViaYtDlp(rawUrl: string): Promise<MediaJob | null> {
  const bin = await ensureYtDlp();
  if (!bin) return null;

  try {
    const { stdout } = await execFileAsync(
      bin,
      ['--js-runtimes', 'node', '--dump-json', '--no-playlist', '--no-warnings', rawUrl],
      { timeout: 18000, maxBuffer: 15 * 1024 * 1024 }
    );
    const info = JSON.parse(stdout) as {
      title?: string;
      uploader?: string;
      duration?: number;
      thumbnail?: string;
      url?: string;
      http_headers?: Record<string, string>;
      formats?: Array<{
        url?: string;
        ext?: string;
        height?: number;
        vcodec?: string;
        acodec?: string;
        filesize?: number;
        filesize_approx?: number;
        tbr?: number;
        protocol?: string;
      }>;
    };

    const streams: SourceStream[] = [];
    for (const f of info.formats ?? []) {
      if (!f.url || f.protocol?.includes('mhtml')) continue;
      const hasVideo = Boolean(f.vcodec && f.vcodec !== 'none');
      const hasAudio = Boolean(f.acodec && f.acodec !== 'none');
      if (!hasVideo && !hasAudio) continue;
      streams.push({
        url: f.url,
        height: f.height,
        hasVideo,
        hasAudio,
        ext: f.ext || 'mp4',
        sizeBytes: f.filesize || f.filesize_approx,
        bitrate: f.tbr ? f.tbr * 1000 : undefined,
        headers: info.http_headers,
      });
    }

    if (streams.length === 0 && info.url) {
      streams.push({
        url: info.url,
        height: 720,
        hasVideo: true,
        hasAudio: true,
        ext: 'mp4',
        headers: info.http_headers,
      });
    }

    const combined = streams.filter((s) => s.hasVideo && s.hasAudio).sort((a, b) => (b.height || 0) - (a.height || 0));
    const videoOnly = streams.filter((s) => s.hasVideo && !s.hasAudio).sort((a, b) => (b.height || 0) - (a.height || 0));
    const audioOnly = streams.filter((s) => !s.hasVideo && s.hasAudio).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

    const bestCombined = combined[0]?.url || videoOnly[0]?.url || streams[0]?.url;
    if (!bestCombined) return null;

    const durationSec = Math.round(info.duration || 60);
    const jobId = crypto.randomUUID();

    return {
      jobId,
      createdAt: Date.now(),
      title: info.title || 'Social Video',
      author: info.uploader || detectPlatform(rawUrl),
      platform: detectPlatform(rawUrl),
      durationSeconds: durationSec,
      thumbnailUrl: info.thumbnail || '',
      sourceUrl: rawUrl,
      bestCombinedUrl: bestCombined,
      bestVideoOnlyUrl: videoOnly[0]?.url,
      bestAudioUrl: audioOnly[0]?.url,
      requestHeaders: info.http_headers,
      streams,
      formats: buildFormatsForDuration(durationSec, streams),
    };
  } catch {
    return null;
  }
}

async function analyzeMediaUrl(rawUrl: string): Promise<MediaJob> {
  const lower = rawUrl.toLowerCase();
  const ytId = extractYouTubeId(rawUrl);

  if (ytId) {
    // 1. Primary Direct Multi-Resolution Free API (144p-1080p native H.264 + M4A)
    const vidSnapJob = await extractYouTubeViaVidSnap(ytId, rawUrl);
    if (vidSnapJob) return vidSnapJob;

    // 2. Secondary Free Keyless API
    const freeApiJob = await extractYouTubeViaFreeApi(ytId, rawUrl);
    if (freeApiJob) return freeApiJob;

    // 3. Fallback to Piped instances
    const pipedJob = await extractYouTubeViaPiped(ytId, rawUrl);
    if (pipedJob) return pipedJob;
  }

  if (lower.includes('tiktok.com')) {
    const ttJob = await extractTikTok(rawUrl);
    if (ttJob) return ttJob;
  }

  if (lower.includes('instagram.com') || lower.includes('instagr.am')) {
    const igJob = await extractInstagram(rawUrl);
    if (igJob) return igJob;
  }

  if (lower.includes('facebook.com') || lower.includes('fb.watch')) {
    const fbJob = await extractFacebook(rawUrl);
    if (fbJob) return fbJob;
  }

  if (lower.includes('twitter.com') || lower.includes('x.com')) {
    const xJob = await extractTwitterX(rawUrl);
    if (xJob) return xJob;
  }

  // Universal free API fallback
  try {
    const aioRes = await abDownloader.aio(rawUrl);
    if (aioRes?.url) {
      const streams: SourceStream[] = [{ url: aioRes.url, height: 720, hasVideo: true, hasAudio: true, ext: 'mp4' }];
      const jobId = crypto.randomUUID();
      return {
        jobId,
        createdAt: Date.now(),
        title: `${detectPlatform(rawUrl)} Video`,
        author: detectPlatform(rawUrl),
        platform: detectPlatform(rawUrl),
        durationSeconds: 45,
        thumbnailUrl: '',
        sourceUrl: rawUrl,
        bestCombinedUrl: aioRes.url,
        streams,
        formats: buildFormatsForDuration(45, streams),
      };
    }
  } catch {
    // continue
  }

  const ytdlpJob = await extractViaYtDlp(rawUrl);
  if (ytdlpJob) return ytdlpJob;

  const directJob = await extractDirectOrOpenGraph(rawUrl);
  if (directJob) return directJob;

  throw new Error(
    'Unable to extract public media streams from this link. Please verify the video is public and paste a valid YouTube, Instagram, TikTok, Facebook, or X link.'
  );
}

async function resolveOrRecoverJob(jobId: string, fallbackUrl?: string): Promise<MediaJob | null> {
  const existing = jobs.get(jobId);
  if (existing) return existing;

  if (!fallbackUrl) return null;
  try {
    const refreshed = await analyzeMediaUrl(fallbackUrl);
    refreshed.jobId = jobId;
    jobs.set(jobId, refreshed);
    return refreshed;
  } catch {
    return null;
  }
}

async function downloadUrlToFileVerified(
  url: string,
  destPath: string,
  customHeaders?: Record<string, string>
): Promise<void> {
  const baseHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    ...(customHeaders || {}),
  };

  const tmpPart = `${destPath}.part_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  // Attempt parallel Range-chunked download first to bypass upstream per-connection throttling
  try {
    const probe = await fetch(url, {
      headers: { ...baseHeaders, Range: 'bytes=0-1' },
      signal: AbortSignal.timeout(8000),
    });
    const contentRange = probe.headers.get('content-range') || '';
    const ct = (probe.headers.get('content-type') || '').toLowerCase();
    probe.body?.cancel();

    const totalMatch = contentRange.match(/\/(\d+)$/);
    const totalBytes = totalMatch ? parseInt(totalMatch[1], 10) : 0;

    if (
      probe.status === 206 &&
      totalBytes > 512 * 1024 &&
      totalBytes < 400 * 1024 * 1024 &&
      !ct.includes('text/html') &&
      !ct.includes('application/json')
    ) {
      const numParts = Math.min(8, Math.max(2, Math.ceil(totalBytes / (2 * 1024 * 1024))));
      const chunkSize = Math.ceil(totalBytes / numParts);

      const buffers = await Promise.all(
        Array.from({ length: numParts }, async (_, idx) => {
          const start = idx * chunkSize;
          const end = Math.min(totalBytes - 1, (idx + 1) * chunkSize - 1);
          const partResp = await fetch(url, {
            headers: { ...baseHeaders, Range: `bytes=${start}-${end}` },
            signal: AbortSignal.timeout(45000),
          });
          if (!partResp.ok && partResp.status !== 206) {
            throw new Error(`Range chunk ${idx} returned HTTP ${partResp.status}`);
          }
          return Buffer.from(await partResp.arrayBuffer());
        })
      );

      fs.writeFileSync(tmpPart, Buffer.concat(buffers));
      const stat = fs.statSync(tmpPart);
      if (stat.size >= 2048) {
        fs.renameSync(tmpPart, destPath);
        return;
      }
      fs.unlinkSync(tmpPart);
    }
  } catch {
    try {
      if (fs.existsSync(tmpPart)) fs.unlinkSync(tmpPart);
    } catch {
      // ignore
    }
  }

  // Fallback: standard streaming download
  const resp = await fetch(url, {
    headers: baseHeaders,
    signal: AbortSignal.timeout(90000),
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`Upstream media stream returned HTTP ${resp.status}`);
  }
  const ct = (resp.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('text/html') || ct.includes('application/json')) {
    throw new Error(`Upstream returned unexpected content-type ${ct}`);
  }

  const fileStream = fs.createWriteStream(tmpPart);
  await pipeline(Readable.fromWeb(resp.body as never), fileStream);

  const stat = fs.statSync(tmpPart);
  if (stat.size < 2048) {
    fs.unlinkSync(tmpPart);
    throw new Error('Upstream stream returned an incomplete media payload.');
  }
  fs.renameSync(tmpPart, destPath);
}

async function probeVideoHeight(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=height', '-of', 'csv=p=0', filePath],
      { timeout: 5000 }
    );
    const h = parseInt(stdout.trim(), 10);
    return Number.isFinite(h) && h > 0 ? h : 360;
  } catch {
    return 360;
  }
}

async function getCachedSpecificStream(job: MediaJob, streamUrl: string, tag: string): Promise<string> {
  const dest = path.join(os.tmpdir(), `src_${tag}_${job.jobId}.media`);
  if (fs.existsSync(dest) && fs.statSync(dest).size >= 2048) {
    return dest;
  }

  const lockKey = `${tag}_${job.jobId}`;
  const existingLock = inFlightDownloads.get(lockKey);
  if (existingLock) return existingLock;

  const task = (async () => {
    await downloadUrlToFileVerified(streamUrl, dest, job.requestHeaders);
    return dest;
  })();

  inFlightDownloads.set(lockKey, task);
  try {
    return await task;
  } finally {
    inFlightDownloads.delete(lockKey);
  }
}

// Deduplicated & cached source video fetcher (prevents rate-limits when clicking multiple buttons)
async function getCachedSourceVideo(job: MediaJob): Promise<string> {
  if (job.cachedVideoPath && fs.existsSync(job.cachedVideoPath)) {
    return job.cachedVideoPath;
  }

  const lockKey = `vid_${job.jobId}`;
  const existingLock = inFlightDownloads.get(lockKey);
  if (existingLock) return existingLock;

  const task = (async () => {
    const dest = path.join(os.tmpdir(), `src_vid_${job.jobId}.mp4`);
    try {
      await downloadUrlToFileVerified(job.bestCombinedUrl, dest, job.requestHeaders);
    } catch {
      const refreshed = await analyzeMediaUrl(job.sourceUrl);
      job.bestCombinedUrl = refreshed.bestCombinedUrl;
      job.bestAudioUrl = refreshed.bestAudioUrl;
      job.streams = refreshed.streams;
      await downloadUrlToFileVerified(job.bestCombinedUrl, dest, job.requestHeaders);
    }
    job.cachedVideoPath = dest;
    job.probedHeight = await probeVideoHeight(dest);
    return dest;
  })();

  inFlightDownloads.set(lockKey, task);
  try {
    return await task;
  } finally {
    inFlightDownloads.delete(lockKey);
  }
}

async function getCachedSourceAudio(job: MediaJob): Promise<string> {
  if (!job.bestAudioUrl) {
    return getCachedSourceVideo(job);
  }
  if (job.cachedAudioPath && fs.existsSync(job.cachedAudioPath)) {
    return job.cachedAudioPath;
  }

  const lockKey = `aud_${job.jobId}`;
  const existingLock = inFlightDownloads.get(lockKey);
  if (existingLock) return existingLock;

  const task = (async () => {
    const dest = path.join(os.tmpdir(), `src_aud_${job.jobId}.media`);
    try {
      await downloadUrlToFileVerified(job.bestAudioUrl!, dest, job.requestHeaders);
      job.cachedAudioPath = dest;
      return dest;
    } catch {
      return getCachedSourceVideo(job);
    }
  })();

  inFlightDownloads.set(lockKey, task);
  try {
    return await task;
  } finally {
    inFlightDownloads.delete(lockKey);
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg conversion exited with code ${code}: ${stderr.slice(0, 300)}`));
    });
  });
}

async function startServer() {
  ensureYtDlp().catch(() => {});

  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '1mb' }));

  // Analyze media link
  app.post('/api/analyze', async (req: Request, res: Response) => {
    try {
      const rawUrl = String(req.body?.url || '').trim();
      if (!rawUrl) {
        res.status(400).json({ error: 'Please paste a video or music link first.' });
        return;
      }

      let normalizedUrl = rawUrl;
      if (!/^https?:\/\//i.test(normalizedUrl)) {
        normalizedUrl = `https://${normalizedUrl}`;
      }

      try {
        new URL(normalizedUrl);
      } catch {
        res.status(400).json({ error: 'Invalid URL format. Please paste a full link starting with https://' });
        return;
      }

      const job = await analyzeMediaUrl(normalizedUrl);
      jobs.set(job.jobId, job);

      const urlQuery = `?url=${encodeURIComponent(job.sourceUrl)}`;
      res.json({
        jobId: job.jobId,
        title: job.title,
        author: job.author,
        platform: job.platform,
        durationSeconds: job.durationSeconds,
        durationFormatted: formatDuration(job.durationSeconds),
        thumbnailProxyUrl: job.thumbnailUrl ? `/api/thumbnail/${job.jobId}${urlQuery}` : '',
        previewStreamUrl: `/api/preview/${job.jobId}${urlQuery}`,
        sourceUrl: job.sourceUrl,
        formats: job.formats.map((f) => ({
          id: f.id,
          category: f.category,
          container: f.container,
          qualityLabel: f.qualityLabel,
          subLabel: f.subLabel,
          sizeBytes: f.sizeBytes,
          sizeFormatted: f.sizeFormatted,
          fast: f.fast,
          primary: f.primary,
        })),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to analyze video link.';
      res.status(422).json({ error: msg });
    }
  });

  // Proxied thumbnail
  app.get('/api/thumbnail/:jobId', async (req: Request, res: Response) => {
    const fallbackUrl = typeof req.query.url === 'string' ? req.query.url : undefined;
    const job = await resolveOrRecoverJob(String(req.params.jobId), fallbackUrl);
    if (!job || !job.thumbnailUrl) {
      res.status(404).end();
      return;
    }
    try {
      const upstream = await fetch(job.thumbnailUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8000),
      });
      if (!upstream.ok || !upstream.body) {
        res.status(404).end();
        return;
      }
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      await pipeline(Readable.fromWeb(upstream.body as never), res);
    } catch {
      if (!res.headersSent) res.status(502).end();
    }
  });

  // Live preview video proxy with local cache & Range support
  app.get('/api/preview/:jobId', async (req: Request, res: Response) => {
    const fallbackUrl = typeof req.query.url === 'string' ? req.query.url : undefined;
    const job = await resolveOrRecoverJob(String(req.params.jobId), fallbackUrl);
    if (!job) {
      res.status(404).send('Session expired.');
      return;
    }

    // Serve directly from cached local file if already fetched
    if (job.cachedVideoPath && fs.existsSync(job.cachedVideoPath)) {
      res.sendFile(job.cachedVideoPath);
      return;
    }

    try {
      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...(job.requestHeaders || {}),
      };
      if (req.headers.range) {
        headers.Range = req.headers.range;
      }

      const upstream = await fetch(job.bestCombinedUrl, { headers });
      res.status(upstream.status);

      const passHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
      for (const h of passHeaders) {
        const val = upstream.headers.get(h);
        if (val) res.setHeader(h, val);
      }
      if (!upstream.headers.get('content-type')) {
        res.setHeader('Content-Type', 'video/mp4');
      }

      if (upstream.body) {
        await pipeline(Readable.fromWeb(upstream.body as never), res);
      } else {
        res.end();
      }
    } catch {
      if (!res.headersSent) res.status(502).end();
    }
  });

  // Fast, stateless-recoverable multi-format download & FFmpeg processor
  app.get('/api/download/:jobId/:formatId', async (req: Request, res: Response) => {
    const fallbackUrl = typeof req.query.url === 'string' ? req.query.url : undefined;
    const job = await resolveOrRecoverJob(String(req.params.jobId), fallbackUrl);
    if (!job) {
      res.status(404).json({ error: 'Download session expired. Please click Download on the link bar again.' });
      return;
    }

    const format = job.formats.find((f) => f.id === req.params.formatId);
    if (!format) {
      res.status(400).json({ error: 'Unsupported format option.' });
      return;
    }

    const ext = format.container.toLowerCase();
    const outputFilePath = path.join(os.tmpdir(), `out_${job.jobId}_${format.id}_${Date.now()}.${ext}`);

    const cleanupOutput = () => {
      try {
        if (fs.existsSync(outputFilePath)) fs.unlinkSync(outputFilePath);
      } catch {
        // ignore
      }
    };

    try {
      const safeTitle = sanitizeFilename(job.title);
      const suffix =
        format.category === 'video_only'
          ? `${format.qualityLabel}_VideoOnly`
          : format.qualityLabel;
      const finalFilename = `${safeTitle}_${suffix}.${ext}`;

      if (format.category === 'music') {
        // Music Only (MP3 at 48k, 128k, 256k, 320k) using lightweight audio source
        const audioInputPath = await getCachedSourceAudio(job);
        const kbps = format.audioKbps || 128;
        await runFfmpeg([
          '-i',
          audioInputPath,
          '-vn',
          '-threads',
          '0',
          '-c:a',
          'libmp3lame',
          '-b:a',
          `${kbps}k`,
          '-metadata',
          `title=${job.title.slice(0, 100)}`,
          '-metadata',
          `artist=${job.author.slice(0, 80)}`,
          outputFilePath,
        ]);
      } else if (format.container === '3GP') {
        // 3GP Mobile Format (144p -> 176x144, 240p -> 320x240) - ultra-fast low-res encode
        const videoInputPath = await getCachedSourceVideo(job);
        const w = format.targetHeight === 144 ? 176 : 320;
        const h = format.targetHeight === 144 ? 144 : 240;
        await runFfmpeg([
          '-i',
          videoInputPath,
          '-threads',
          '0',
          '-vf',
          `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
          '-c:v',
          'mpeg4',
          '-b:v',
          format.targetHeight === 144 ? '120k' : '240k',
          '-c:a',
          'aac',
          '-ar',
          '16000',
          '-ac',
          '1',
          '-b:a',
          '32k',
          '-f',
          '3gp',
          outputFilePath,
        ]);
      } else if (format.category === 'video_only') {
        // Video Only (Muted MP4) - uses native resolution stream if available for instant lossless mux
        const targetH = format.targetHeight || 720;
        const nativeVo = job.streams.find(
          (s) => s.hasVideo && !s.hasAudio && s.ext === 'mp4' && s.height === targetH
        );

        if (nativeVo) {
          const voPath = await getCachedSpecificStream(job, nativeVo.url, `vo_${targetH}`);
          await runFfmpeg([
            '-i',
            voPath,
            '-an',
            '-c:v',
            'copy',
            '-movflags',
            '+faststart',
            outputFilePath,
          ]);
        } else {
          const videoInputPath = await getCachedSourceVideo(job);
          const srcHeight = job.probedHeight || 360;
          if (targetH >= srcHeight || job.durationSeconds > 180) {
            await runFfmpeg([
              '-i',
              videoInputPath,
              '-an',
              '-c:v',
              'copy',
              '-movflags',
              '+faststart',
              outputFilePath,
            ]);
          } else {
            await runFfmpeg([
              '-i',
              videoInputPath,
              '-an',
              '-threads',
              '0',
              '-vf',
              `scale=-2:${targetH}`,
              '-c:v',
              'libx264',
              '-preset',
              'ultrafast',
              '-crf',
              '25',
              '-pix_fmt',
              'yuv420p',
              '-movflags',
              '+faststart',
              outputFilePath,
            ]);
          }
        }
      } else {
        // Standard Video + Audio MP4 (144P, 240P, 360P, 480P, 720P, 1080P)
        const targetH = format.targetHeight || 360;
        const nativeCombined = job.streams.find(
          (s) => s.hasVideo && s.hasAudio && s.ext === 'mp4' && s.height === targetH
        );
        const nativeVo = job.streams.find(
          (s) => s.hasVideo && !s.hasAudio && s.ext === 'mp4' && s.height === targetH
        );

        if (nativeCombined) {
          const combPath = await getCachedSpecificStream(job, nativeCombined.url, `comb_${targetH}`);
          await runFfmpeg([
            '-i',
            combPath,
            '-c',
            'copy',
            '-movflags',
            '+faststart',
            outputFilePath,
          ]);
        } else if (nativeVo && job.bestAudioUrl) {
          const [voPath, audPath] = await Promise.all([
            getCachedSpecificStream(job, nativeVo.url, `vo_${targetH}`),
            getCachedSourceAudio(job),
          ]);
          const isM4a = job.streams.some((s) => s.url === job.bestAudioUrl && s.ext === 'm4a');
          await runFfmpeg([
            '-i',
            voPath,
            '-i',
            audPath,
            '-c:v',
            'copy',
            '-c:a',
            isM4a ? 'copy' : 'aac',
            ...(isM4a ? [] : ['-b:a', '128k']),
            '-shortest',
            '-movflags',
            '+faststart',
            outputFilePath,
          ]);
        } else {
          const videoInputPath = await getCachedSourceVideo(job);
          const srcHeight = job.probedHeight || 360;
          const shouldRemuxCopy =
            targetH === srcHeight ||
            (targetH > srcHeight && job.durationSeconds > 120) ||
            (targetH >= 360 && srcHeight <= 360 && job.durationSeconds > 90);

          if (shouldRemuxCopy) {
            await runFfmpeg([
              '-i',
              videoInputPath,
              '-c',
              'copy',
              '-movflags',
              '+faststart',
              outputFilePath,
            ]);
          } else {
            await runFfmpeg([
              '-i',
              videoInputPath,
              '-threads',
              '0',
              '-vf',
              `scale=-2:${targetH}`,
              '-c:v',
              'libx264',
              '-preset',
              'ultrafast',
              '-crf',
              targetH >= 720 ? '23' : '26',
              '-pix_fmt',
              'yuv420p',
              '-c:a',
              'aac',
              '-b:a',
              '128k',
              '-movflags',
              '+faststart',
              outputFilePath,
            ]);
          }
        }
      }

      const stat = fs.statSync(outputFilePath);
      const mimeType =
        format.container === 'MP3'
          ? 'audio/mpeg'
          : format.container === '3GP'
          ? 'video/3gpp'
          : 'video/mp4';

      const asciiFallback = finalFilename.replace(/[^\x20-\x7E]/g, '_');
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Length', String(stat.size));
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(finalFilename)}`
      );

      const readStream = fs.createReadStream(outputFilePath);
      readStream.on('close', cleanupOutput);
      readStream.on('error', cleanupOutput);
      readStream.pipe(res);
    } catch (err) {
      cleanupOutput();
      if (!res.headersSent) {
        const msg = err instanceof Error ? err.message : 'Download processing failed.';
        res.status(500).json({ error: msg });
      }
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

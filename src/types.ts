export type FormatCategory = 'video' | 'video_only' | 'music';

export interface DownloadFormatOption {
  id: string;
  category: FormatCategory;
  container: 'MP4' | '3GP' | 'MP3';
  qualityLabel: string;
  subLabel?: string;
  sizeBytes: number;
  sizeFormatted: string;
  fast?: boolean;
  primary?: boolean;
}

export interface MediaAnalysisResult {
  jobId: string;
  title: string;
  author: string;
  platform: string;
  durationSeconds: number;
  durationFormatted: string;
  thumbnailProxyUrl: string;
  previewStreamUrl: string;
  sourceUrl: string;
  formats: DownloadFormatOption[];
}

export interface RecentDownloadItem {
  id: string;
  title: string;
  platform: string;
  container: 'MP4' | '3GP' | 'MP3';
  qualityLabel: string;
  category: FormatCategory;
  sizeFormatted: string;
  timestamp: number;
  sourceUrl: string;
}

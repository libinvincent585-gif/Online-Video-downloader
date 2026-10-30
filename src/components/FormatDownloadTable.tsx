import React, { useState } from 'react';
import {
  Download,
  Film,
  Music,
  VolumeX,
  CheckCircle2,
  Loader2,
  Share2,
  Zap,
  AlertCircle,
} from 'lucide-react';
import type { DownloadFormatOption, FormatCategory, MediaAnalysisResult } from '../types';

interface FormatDownloadTableProps {
  media: MediaAnalysisResult;
  activeFilter: 'all' | FormatCategory;
  onFilterChange: (filter: 'all' | FormatCategory) => void;
  lang: 'en' | 'ml';
  onDownloadComplete: (format: DownloadFormatOption) => void;
}

interface ActiveDownloadState {
  status: 'processing' | 'downloading' | 'done' | 'error';
  progress: number;
  file?: File;
  blobUrl?: string;
  filename?: string;
  errorMsg?: string;
}

export const FormatDownloadTable: React.FC<FormatDownloadTableProps> = ({
  media,
  activeFilter,
  onFilterChange,
  lang,
  onDownloadComplete,
}) => {
  const [showAllFormats, setShowAllFormats] = useState(false);
  const [downloadStates, setDownloadStates] = useState<Record<string, ActiveDownloadState>>({});

  const canNativeShareFiles = (file?: File): boolean => {
    if (!file || typeof navigator === 'undefined' || !navigator.canShare) return false;
    try {
      return navigator.canShare({ files: [file] });
    } catch {
      return false;
    }
  };

  const triggerBrowserSave = (hrefUrl: string, filename?: string) => {
    const a = document.createElement('a');
    a.href = hrefUrl;
    if (filename) {
      a.download = filename;
    }
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
    }, 300);
  };

  const handleDownload = async (format: DownloadFormatOption) => {
    const existing = downloadStates[format.id];
    if (existing?.status === 'processing' || existing?.status === 'downloading') {
      return;
    }

    // If already downloaded in memory, save immediately again without re-fetching
    if (existing?.status === 'done' && existing.blobUrl && existing.filename) {
      triggerBrowserSave(existing.blobUrl, existing.filename);
      return;
    }

    const downloadEndpoint = `/api/download/${media.jobId}/${format.id}?url=${encodeURIComponent(media.sourceUrl)}`;

    setDownloadStates((prev) => ({
      ...prev,
      [format.id]: { status: 'processing', progress: 15 },
    }));

    try {
      const response = await fetch(downloadEndpoint);
      if (!response.ok) {
        let errText = 'Download failed. Please tap Retry.';
        try {
          const errJson = await response.json();
          if (errJson?.error) errText = errJson.error;
        } catch {
          // ignore
        }
        throw new Error(errText);
      }

      const contentLength = Number(response.headers.get('content-length') || 0);
      const disposition = response.headers.get('content-disposition') || '';
      const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      const asciiMatch = disposition.match(/filename="([^"]+)"/i);

      const ext = format.container.toLowerCase();
      const fallbackName = `${media.title.replace(/[^a-zA-Z0-9\u0D00-\u0D7F _-]/g, '').trim().slice(0, 50) || 'media'}_${format.qualityLabel}.${ext}`;
      const filename = utf8Match
        ? decodeURIComponent(utf8Match[1])
        : asciiMatch
        ? asciiMatch[1]
        : fallbackName;

      const mimeType =
        format.container === 'MP3'
          ? 'audio/mpeg'
          : format.container === '3GP'
          ? 'video/3gpp'
          : 'video/mp4';

      let blob: Blob;

      if (response.body && contentLength > 0) {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;

        setDownloadStates((prev) => ({
          ...prev,
          [format.id]: { status: 'downloading', progress: 22 },
        }));

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            received += value.length;
            const pct = Math.min(99, Math.max(22, Math.round((received / contentLength) * 100)));
            setDownloadStates((prev) => ({
              ...prev,
              [format.id]: { status: 'downloading', progress: pct },
            }));
          }
        }
        blob = new Blob(chunks as BlobPart[], { type: mimeType });
      } else {
        setDownloadStates((prev) => ({
          ...prev,
          [format.id]: { status: 'downloading', progress: 70 },
        }));
        const rawBlob = await response.blob();
        blob = new Blob([rawBlob], { type: mimeType });
      }

      const blobUrl = URL.createObjectURL(blob);
      const fileObj = new File([blob], filename, { type: mimeType });

      triggerBrowserSave(blobUrl, filename);
      onDownloadComplete(format);

      setDownloadStates((prev) => ({
        ...prev,
        [format.id]: {
          status: 'done',
          progress: 100,
          file: fileObj,
          blobUrl,
          filename,
        },
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to save file.';
      setDownloadStates((prev) => ({
        ...prev,
        [format.id]: { status: 'error', progress: 0, errorMsg: msg },
      }));
    }
  };

  const handleShareToGallery = async (formatId: string) => {
    const state = downloadStates[formatId];
    if (!state?.file) return;
    try {
      await navigator.share({
        files: [state.file],
        title: state.filename,
      });
    } catch {
      // User dismissed share sheet
    }
  };

  const filterVisible = (items: DownloadFormatOption[]) => {
    if (showAllFormats || activeFilter !== 'all') return items;
    return items.filter((item) => item.primary !== false);
  };

  const videoFormats = filterVisible(media.formats.filter((f) => f.category === 'video'));
  const videoOnlyFormats = filterVisible(media.formats.filter((f) => f.category === 'video_only'));
  const musicFormats = filterVisible(media.formats.filter((f) => f.category === 'music'));

  const renderFormatRow = (item: DownloadFormatOption) => {
    const dlState = downloadStates[item.id];
    const isBusy = dlState?.status === 'processing' || dlState?.status === 'downloading';
    const isDone = dlState?.status === 'done';
    const isError = dlState?.status === 'error';

    return (
      <div
        key={item.id}
        className="px-4 py-3.5 border-b border-slate-100 last:border-b-0 hover:bg-slate-50/70 transition-colors"
      >
        <div className="flex items-center justify-between gap-3">
          {/* Left: Format tag + Resolution + File Size */}
          <div className="flex items-center gap-3 min-w-0">
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-bold tracking-wide text-white shrink-0 ${
                item.container === '3GP'
                  ? 'bg-[#0284c7]'
                  : 'bg-[#f59e0b]'
              }`}
            >
              {item.container}
            </span>

            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 min-w-0">
              <span className="text-[15px] font-bold text-slate-900 tabular-nums whitespace-nowrap">
                {item.qualityLabel}
              </span>
              <span className="text-[14px] font-semibold text-slate-600 tabular-nums whitespace-nowrap font-mono">
                {item.sizeFormatted}
              </span>
              {item.subLabel && (
                <span className="text-xs text-slate-500 whitespace-nowrap">
                  · {item.subLabel}
                </span>
              )}
            </div>
          </div>

          {/* Right: Download Button & Mobile Gallery Share */}
          <div className="flex items-center gap-2 shrink-0">
            {isDone && dlState?.file && canNativeShareFiles(dlState.file) && (
              <button
                type="button"
                onClick={() => handleShareToGallery(item.id)}
                title={lang === 'ml' ? 'ഗാലറിയിലേക്ക് സേവ് ചെയ്യുക' : 'Save to Phone Gallery'}
                className="min-h-[44px] px-3 rounded-lg border border-sky-600 text-sky-700 hover:bg-sky-50 text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>{lang === 'ml' ? 'ഗാലറി' : 'Gallery'}</span>
              </button>
            )}

            <button
              type="button"
              disabled={isBusy}
              onClick={() => handleDownload(item)}
              className={`relative min-h-[44px] min-w-[134px] px-4 py-2 rounded-lg border-[1.5px] font-semibold text-sm flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isBusy
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700 cursor-wait'
                  : isDone
                  ? 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700'
                  : isError
                  ? 'border-red-500 text-red-600 hover:bg-red-50'
                  : 'border-[#16a34a] text-[#16a34a] bg-white hover:bg-[#16a34a] hover:text-white active:scale-[0.98]'
              }`}
            >
              {item.fast && !isBusy && !isDone && !isError && (
                <span className="absolute -top-[1px] -right-[1px] bg-[#16a34a] text-white text-[10px] font-semibold leading-none px-1.5 py-0.5 rounded-bl-md rounded-tr-[6px] flex items-center gap-0.5">
                  <Zap className="w-2.5 h-2.5 fill-current" />
                  Fast
                </span>
              )}

              {isBusy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  <span className="tabular-nums text-xs">
                    {dlState.status === 'processing'
                      ? lang === 'ml'
                        ? 'തയ്യാറാക്കുന്നു...'
                        : 'Preparing...'
                      : `${dlState.progress}%`}
                  </span>
                </>
              ) : isDone ? (
                <>
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{lang === 'ml' ? 'സേവ് ആയി' : 'Saved'}</span>
                </>
              ) : isError ? (
                <>
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>Retry</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 shrink-0" />
                  <span>{lang === 'ml' ? 'ഡൗൺലോഡ്' : 'Download'}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {isError && dlState.errorMsg && (
          <p className="mt-2 text-xs text-red-600">{dlState.errorMsg}</p>
        )}
      </div>
    );
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      {/* Mode Filter Segmented Control */}
      <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center gap-1.5 overflow-x-auto">
        <button
          type="button"
          onClick={() => onFilterChange('all')}
          className={`min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activeFilter === 'all'
              ? 'bg-[#16a34a] text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
          }`}
        >
          {lang === 'ml' ? 'എല്ലാം (All)' : 'All Formats'}
        </button>
        <button
          type="button"
          onClick={() => onFilterChange('video')}
          className={`min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activeFilter === 'video'
              ? 'bg-[#16a34a] text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
          }`}
        >
          {lang === 'ml' ? 'വീഡിയോ (MP4 / 3GP)' : 'Video (MP4 & 3GP)'}
        </button>
        <button
          type="button"
          onClick={() => onFilterChange('music')}
          className={`min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activeFilter === 'music'
              ? 'bg-[#16a34a] text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
          }`}
        >
          {lang === 'ml' ? 'മ്യൂസിക് മാത്രം (MP3)' : 'Music Only (MP3)'}
        </button>
        <button
          type="button"
          onClick={() => onFilterChange('video_only')}
          className={`min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activeFilter === 'video_only'
              ? 'bg-[#16a34a] text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
          }`}
        >
          {lang === 'ml' ? 'വീഡിയോ മാത്രം (No Audio)' : 'Video Only (Muted)'}
        </button>
      </div>

      {/* Section 1: Video (MP4 & 3GP with Audio) */}
      {(activeFilter === 'all' || activeFilter === 'video') && (
        <div>
          <div className="px-4 py-3 bg-white border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="w-6 h-6 rounded-md bg-emerald-100 text-[#16a34a] flex items-center justify-center shrink-0">
                <Film className="w-4 h-4" />
              </span>
              <h3 className="text-base font-bold text-slate-900">
                {lang === 'ml' ? 'Video (വീഡിയോ + ഓഡിയോ)' : 'Video'}
              </h3>
            </div>
            <span className="text-xs text-slate-500">MP4 · 3GP · 144P – 1080P</span>
          </div>
          <div>{videoFormats.map(renderFormatRow)}</div>
        </div>
      )}

      {/* Section 2: Music Only (MP3) */}
      {(activeFilter === 'all' || activeFilter === 'music') && (
        <div>
          <div className="px-4 py-3 bg-slate-50/60 border-y border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="w-6 h-6 rounded-md bg-emerald-100 text-[#16a34a] flex items-center justify-center shrink-0">
                <Music className="w-4 h-4" />
              </span>
              <h3 className="text-base font-bold text-slate-900">
                {lang === 'ml' ? 'Music (മ്യൂസിക് മാത്രം)' : 'Music'}
              </h3>
            </div>
            <span className="text-xs text-slate-500">MP3 Audio Only</span>
          </div>
          <div>{musicFormats.map(renderFormatRow)}</div>
        </div>
      )}

      {/* Section 3: Video Only (No Audio / Muted) */}
      {(activeFilter === 'all' || activeFilter === 'video_only') && (
        <div>
          <div className="px-4 py-3 bg-slate-50/60 border-y border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="w-6 h-6 rounded-md bg-sky-100 text-sky-700 flex items-center justify-center shrink-0">
                <VolumeX className="w-4 h-4" />
              </span>
              <h3 className="text-base font-bold text-slate-900">
                {lang === 'ml' ? 'Video Only (വീഡിയോ മാത്രം · ശബ്ദമില്ല)' : 'Video Only (No Sound)'}
              </h3>
            </div>
            <span className="text-xs text-slate-500">Muted MP4 · 360P – 1080P</span>
          </div>
          <div>{videoOnlyFormats.map(renderFormatRow)}</div>
        </div>
      )}

      {/* Show More / Show Less Toggle */}
      {activeFilter === 'all' && (
        <div className="py-3.5 px-4 text-center border-t border-slate-100 bg-white">
          <button
            type="button"
            onClick={() => setShowAllFormats((prev) => !prev)}
            className="min-h-[40px] px-4 text-sm font-semibold text-[#16a34a] underline underline-offset-4 hover:text-emerald-700 transition-colors cursor-pointer"
          >
            {showAllFormats
              ? lang === 'ml'
                ? 'കുറച്ച് കാണിക്കുക (Show Less)'
                : 'Show Less'
              : lang === 'ml'
              ? 'എല്ലാ ഫോർമാറ്റുകളും കാണുക (Show More: 144P, 240P, 3GP, 320KBPS)'
              : 'Show More'}
          </button>
        </div>
      )}
    </div>
  );
};

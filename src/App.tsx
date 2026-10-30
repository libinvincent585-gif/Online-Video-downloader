/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  Globe,
  ArrowDownCircle,
  X,
  Clock,
  Loader2,
  AlertCircle,
  ClipboardPaste,
  Trash2,
  RotateCcw,
  Film,
  Music,
  VolumeX,
} from 'lucide-react';
import type {
  DownloadFormatOption,
  FormatCategory,
  MediaAnalysisResult,
  RecentDownloadItem,
} from './types';
import { FormatDownloadTable } from './components/FormatDownloadTable';
import { PlatformToolsGrid, TOOL_PRESETS, type ToolPreset } from './components/PlatformToolsGrid';

const RECENT_STORAGE_KEY = 'media_downloader_recent_v1';

const SAMPLE_LINKS = [
  {
    labelEn: 'YouTube Classic Clip',
    labelMl: 'YouTube സാമ്പിൾ',
    url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
  },
  {
    labelEn: 'HD Blender Film',
    labelMl: 'HD അനിമേഷൻ വീഡിയോ',
    url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
  },
  {
    labelEn: 'TikTok Sample',
    labelMl: 'TikTok വീഡിയോ',
    url: 'https://www.tiktok.com/@scout2015/video/6718335390845095173',
  },
];

export default function App() {
  const [urlInput, setUrlInput] = useState('');
  const [lang, setLang] = useState<'en' | 'ml'>('en');
  const [selectedPreset, setSelectedPreset] = useState<ToolPreset>(TOOL_PRESETS[0]);
  const [activeFilter, setActiveFilter] = useState<'all' | FormatCategory>('all');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mediaResult, setMediaResult] = useState<MediaAnalysisResult | null>(null);
  const [thumbError, setThumbError] = useState(false);
  const [recentDownloads, setRecentDownloads] = useState<RecentDownloadItem[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(RECENT_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setRecentDownloads(parsed.slice(0, 12));
        }
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const saveRecentDownload = (format: DownloadFormatOption) => {
    if (!mediaResult) return;
    const newItem: RecentDownloadItem = {
      id: `${mediaResult.jobId}_${format.id}_${Date.now()}`,
      title: mediaResult.title,
      platform: mediaResult.platform,
      container: format.container,
      qualityLabel: format.qualityLabel,
      category: format.category,
      sizeFormatted: format.sizeFormatted,
      timestamp: Date.now(),
      sourceUrl: mediaResult.sourceUrl,
    };

    setRecentDownloads((prev) => {
      const next = [newItem, ...prev].slice(0, 12);
      try {
        localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const clearRecentHistory = () => {
    setRecentDownloads([]);
    try {
      localStorage.removeItem(RECENT_STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  const analyzeUrl = async (targetUrl: string) => {
    const trimmed = targetUrl.trim();
    if (!trimmed) {
      setErrorMsg(
        lang === 'ml'
          ? 'ദയവായി ഒരു വീഡിയോ ലിങ്ക് പേസ്റ്റ് ചെയ്യുക.'
          : 'Please paste a video link from YouTube, Instagram, TikTok, Facebook, or X.'
      );
      inputRef.current?.focus();
      return;
    }

    setIsAnalyzing(true);
    setErrorMsg(null);
    setThumbError(false);

    try {
      const resp = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.error || 'Could not process this link.');
      }
      setMediaResult(data as MediaAnalysisResult);
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to fetch video formats.';
      setErrorMsg(msg);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    analyzeUrl(urlInput);
  };

  const handlePasteFromClipboard = async () => {
    inputRef.current?.focus();
    try {
      if (navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          setUrlInput(text.trim());
          setErrorMsg(null);
          analyzeUrl(text.trim());
        }
      }
    } catch {
      // Clipboard permission denied in iframe; focus input so user can Ctrl+V / long-press Paste
      inputRef.current?.focus();
    }
  };

  const handleSelectPreset = (preset: ToolPreset) => {
    setSelectedPreset(preset);
    setActiveFilter(preset.filter);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => {
      inputRef.current?.focus();
    }, 250);
  };

  return (
    <div id="top" className="min-h-screen flex flex-col bg-[#f4f7f9] text-slate-900">
      {/* Top Bar Contract: 3 clean zones separated by gap-8, zero unwanted brand names */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-8 px-4 sm:px-6 h-14">
          <a
            href="#top"
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            Video Downloader
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a
              href="#top"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Downloader
            </a>
            <a
              href="#tools"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Supported Tools
            </a>
            <a
              href="#formats"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Formats
            </a>
            <a
              href="#recent"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Recent Saves
            </a>
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={handlePasteFromClipboard}
              className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-[#16a34a] rounded-lg hover:bg-emerald-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Paste Link
            </button>
          </div>
        </div>
      </header>

      {/* Hero Paste & Download Section (Modelled on clean blue-to-teal banner without third-party branding) */}
      <section className="bg-gradient-to-b from-[#0284c7] via-[#0396c7] to-[#00b894] text-white pt-8 pb-10 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto">
          {/* Language Switcher inside Hero Workspace */}
          <div className="flex items-center justify-between gap-4 mb-5">
            <p className="text-xs sm:text-sm text-white/90 font-medium">
              YouTube · Instagram · TikTok · Facebook · X
            </p>
            <div className="inline-flex items-center p-0.5 rounded-lg bg-black/20 backdrop-blur-xs">
              <button
                type="button"
                onClick={() => setLang('en')}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  lang === 'en' ? 'bg-white text-slate-900' : 'text-white/90 hover:text-white'
                }`}
              >
                English
              </button>
              <button
                type="button"
                onClick={() => setLang('ml')}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  lang === 'ml' ? 'bg-white text-slate-900' : 'text-white/90 hover:text-white'
                }`}
              >
                മലയാളം
              </button>
            </div>
          </div>

          <div className="text-center max-w-2xl mx-auto mb-6">
            <h1
              className="font-bold tracking-tight text-white leading-tight"
              style={{ fontSize: 'clamp(1.85rem, 3.8vw, 2.85rem)', textWrap: 'balance' }}
            >
              {lang === 'ml'
                ? 'ഓൺലൈൻ വീഡിയോ & മ്യൂസിക് ഡൗൺലോഡർ'
                : 'Online Video & Music Downloader'}
            </h1>
            <p className="mt-2.5 text-sm sm:text-base text-white/95 leading-relaxed">
              {lang === 'ml'
                ? 'YouTube, Instagram തുടങ്ങിയ സോഷ്യൽ മീഡിയ ലിങ്കുകൾ പേസ്റ്റ് ചെയ്ത് 1080P, 720P, 360P, 3GP, മ്യൂസിക് മാത്രം (MP3), വീഡിയോ മാത്രം എന്നീ ഫോർമാറ്റുകളിൽ ഫോൺ ഗാലറിയിലേക്ക് സേവ് ചെയ്യാം.'
                : 'Save videos and audio in MP4 (1080P, 720P, 360P), 3GP, Video-Only, or MP3 Music directly to your device gallery.'}
            </p>
          </div>

          {/* Search / Paste Bar matching Screenshot Model */}
          <form
            onSubmit={handleFormSubmit}
            className="bg-white rounded-xl p-1.5 shadow-lg shadow-slate-950/15 flex items-center gap-1.5 max-w-3xl mx-auto"
          >
            <div className="flex items-center flex-1 min-w-0 pl-3 gap-2.5">
              {urlInput ? (
                <button
                  type="button"
                  onClick={() => {
                    setUrlInput('');
                    setErrorMsg(null);
                    inputRef.current?.focus();
                  }}
                  aria-label="Clear link"
                  className="w-9 h-9 -ml-1 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors shrink-0 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              ) : (
                <Globe className="w-5 h-5 text-slate-400 shrink-0" />
              )}

              <input
                ref={inputRef}
                type="text"
                value={urlInput}
                onChange={(e) => {
                  setUrlInput(e.target.value);
                  if (errorMsg) setErrorMsg(null);
                }}
                placeholder={
                  lang === 'ml'
                    ? 'വീഡിയോ ലിങ്ക് ഇവിടെ പേസ്റ്റ് ചെയ്യുക...'
                    : selectedPreset.placeholder
                }
                className="w-full py-3 text-base text-slate-900 placeholder:text-slate-400 bg-transparent focus:outline-none min-w-0"
              />

              {!urlInput && (
                <button
                  type="button"
                  onClick={handlePasteFromClipboard}
                  title="Paste from clipboard"
                  className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                  <span>{lang === 'ml' ? 'പേസ്റ്റ്' : 'Paste'}</span>
                </button>
              )}
            </div>

            <button
              type="submit"
              disabled={isAnalyzing}
              className="min-h-[48px] px-5 sm:px-6 py-2.5 rounded-lg bg-[#12b855] hover:bg-[#0fa34a] disabled:opacity-75 text-white font-bold text-sm sm:text-base flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer active:scale-[0.99]"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin shrink-0" />
                  <span>{lang === 'ml' ? 'പരിശോധിക്കുന്നു...' : 'Loading...'}</span>
                </>
              ) : (
                <>
                  <ArrowDownCircle className="w-5 h-5 shrink-0" />
                  <span>{lang === 'ml' ? 'Download' : 'Download'}</span>
                </>
              )}
            </button>
          </form>

          {/* Error Feedback */}
          {errorMsg && (
            <div className="max-w-3xl mx-auto mt-3 p-3.5 rounded-xl bg-red-950/45 border border-white/25 text-white text-sm flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Quick 1-Tap Sample Links for Instant Testing */}
          <div className="max-w-3xl mx-auto mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-xs text-white/90">
            <span className="font-medium opacity-85">
              {lang === 'ml' ? 'പരീക്ഷിക്കാൻ സാമ്പിൾ ലിങ്കുകൾ:' : 'Try a quick sample:'}
            </span>
            {SAMPLE_LINKS.map((sample) => (
              <button
                key={sample.url}
                type="button"
                onClick={() => {
                  setUrlInput(sample.url);
                  analyzeUrl(sample.url);
                }}
                className="underline underline-offset-4 hover:text-white font-semibold transition-opacity cursor-pointer whitespace-nowrap"
              >
                {lang === 'ml' ? sample.labelMl : sample.labelEn}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Active Extraction Results Card (Matches Screenshot 1 & 2 layout cleanly without ads) */}
      <main className="flex-1">
        {(isAnalyzing || mediaResult) && (
          <div
            ref={resultsRef}
            className="max-w-6xl mx-auto px-3 sm:px-6 -mt-5 pb-6 relative z-10"
          >
            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-md p-4 sm:p-6">
              {isAnalyzing && !mediaResult ? (
                <div className="py-14 flex flex-col items-center justify-center text-center">
                  <Loader2 className="w-9 h-9 text-[#16a34a] animate-spin mb-3" />
                  <p className="text-base font-semibold text-slate-900">
                    {lang === 'ml'
                      ? 'വീഡിയോയും ഓഡിയോ ഫോർമാറ്റുകളും തയ്യാറാക്കുന്നു...'
                      : 'Extracting available MP4, 3GP, Video-Only & MP3 formats...'}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {lang === 'ml' ? 'ദയവായി അല്പസമയം കാത്തിരിക്കുക' : 'Checking stream resolutions and file sizes'}
                  </p>
                </div>
              ) : mediaResult ? (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  {/* Left Column: Live Video Preview & Metadata */}
                  <div className="lg:col-span-5">
                    <div className="rounded-xl overflow-hidden bg-slate-950 aspect-video relative border border-slate-200">
                      <video
                        key={mediaResult.jobId}
                        src={mediaResult.previewStreamUrl}
                        poster={
                          !thumbError && mediaResult.thumbnailProxyUrl
                            ? mediaResult.thumbnailProxyUrl
                            : undefined
                        }
                        controls
                        playsInline
                        preload="metadata"
                        className="w-full h-full object-contain bg-slate-950"
                      />
                      {/* Hidden img probe to detect broken poster cleanly */}
                      {mediaResult.thumbnailProxyUrl && !thumbError && (
                        <img
                          src={mediaResult.thumbnailProxyUrl}
                          alt={mediaResult.title}
                          referrerPolicy="no-referrer"
                          onError={() => setThumbError(true)}
                          className="hidden"
                        />
                      )}
                    </div>

                    {/* Title + Duration Row matching Screenshot 2 */}
                    <div className="mt-3.5 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-base sm:text-lg font-bold text-slate-900 leading-snug line-clamp-2">
                          {mediaResult.title}
                        </h2>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span className="font-medium text-slate-700">{mediaResult.platform}</span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate max-w-[200px]">{mediaResult.author}</span>
                        </div>
                      </div>

                      <div className="px-2.5 py-1 rounded-md bg-emerald-100 text-emerald-800 text-xs font-bold tabular-nums flex items-center gap-1 shrink-0">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{mediaResult.durationFormatted}</span>
                      </div>
                    </div>

                    <p className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500 leading-relaxed">
                      {lang === 'ml'
                        ? 'ഏത് ഫോർമാറ്റിന്റെയും നേരെയുള്ള Download ബട്ടൺ അമർത്തിയാൽ ഫയൽ നേരിട്ട് ഫോണിലെ Downloads / Gallery-ലേക്ക് സേവ് ആകും.'
                        : 'Tap Download on any format to save directly to your phone Downloads or Gallery folder.'}
                    </p>
                  </div>

                  {/* Right Column: Multi-Format Download Table */}
                  <div className="lg:col-span-7">
                    <FormatDownloadTable
                      media={mediaResult}
                      activeFilter={activeFilter}
                      onFilterChange={setActiveFilter}
                      lang={lang}
                      onDownloadComplete={saveRecentDownload}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* Quick Mode & Platform Tools List (Matching Screenshot 3 cleanly) */}
        <PlatformToolsGrid
          selectedPresetId={selectedPreset.id}
          lang={lang}
          onSelectPreset={handleSelectPreset}
        />

        {/* Supported Output Modes Overview */}
        <section id="formats" className="max-w-5xl mx-auto px-4 sm:px-6 pb-10">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight mb-6">
              {lang === 'ml'
                ? 'ലഭ്യമായ എല്ലാ ഡൗൺലോഡ് രീതികളും'
                : 'All Supported Download Modes'}
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-[#16a34a] flex items-center justify-center mb-3">
                  <Film className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-slate-900">
                  {lang === 'ml' ? '01. വീഡിയോ + ഓഡിയോ (MP4 & 3GP)' : '01. Video + Audio (MP4 & 3GP)'}
                </h3>
                <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
                  {lang === 'ml'
                    ? '1080P Full HD, 720P HD, 480P, 360P, 240P, 144P, കൂടാതെ ചെറിയ ഫോണുകൾക്കായി 3GP ഫോർമാറ്റിലും സേവ് ചെയ്യാം.'
                    : 'Full-resolution 1080P, 720P, 480P, 360P, 240P, 144P MP4 files plus lightweight 3GP mobile formats.'}
                </p>
              </div>

              <div>
                <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center mb-3">
                  <Music className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-slate-900">
                  {lang === 'ml' ? '02. മ്യൂസിക് മാത്രം (MP3 Audio)' : '02. Music Only (MP3 Audio)'}
                </h3>
                <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
                  {lang === 'ml'
                    ? 'വീഡിയോയിൽ നിന്ന് പാട്ടുകളും ഓഡിയോയും മാത്രമായി 320KBPS, 256KBPS, 128KBPS, 48KBPS MP3 ആയി ഡൗൺലോഡ് ചെയ്യാം.'
                    : 'Extract clean standalone MP3 audio tracks in 320KBPS, 256KBPS, 128KBPS, or data-saving 48KBPS.'}
                </p>
              </div>

              <div>
                <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center mb-3">
                  <VolumeX className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-slate-900">
                  {lang === 'ml' ? '03. വീഡിയോ മാത്രം (No Sound)' : '03. Video Only (Muted MP4)'}
                </h3>
                <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
                  {lang === 'ml'
                    ? 'എഡിറ്റിംഗിനും സ്റ്റാറ്റസുകൾക്കുമായി ശബ്ദമില്ലാത്ത ക്ലീൻ വീഡിയോ മാത്രമായി (1080P / 720P / 360P) സേവ് ചെയ്യാം.'
                    : 'Save clean silent video streams without background audio for editing, B-roll, and status clips.'}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Recent Downloads Section */}
        <section id="recent" className="max-w-5xl mx-auto px-4 sm:px-6 pb-14">
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {lang === 'ml' ? 'അവസാനം ഡൗൺലോഡ് ചെയ്തവ' : 'Recent Saves'}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {lang === 'ml'
                    ? 'നിങ്ങൾ ഈ ബ്രൗസറിൽ സേവ് ചെയ്ത ഫയലുകളുടെ വിവരങ്ങൾ'
                    : 'Quickly re-open links you downloaded in this browser'}
                </p>
              </div>

              {recentDownloads.length > 0 && (
                <button
                  type="button"
                  onClick={clearRecentHistory}
                  className="min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-red-600 hover:bg-red-50 flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{lang === 'ml' ? 'മായ്ക്കുക' : 'Clear'}</span>
                </button>
              )}
            </div>

            {recentDownloads.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500 border-t border-slate-100">
                {lang === 'ml'
                  ? 'ഇതുവരെ ഡൗൺലോഡുകൾ ഒന്നും ചെയ്തിട്ടില്ല. മുകളിൽ ഒരു ലിങ്ക് പേസ്റ്റ് ചെയ്ത് തുടങ്ങൂ.'
                  : 'No recent downloads yet. Paste any video link above to save your first file.'}
              </div>
            ) : (
              <div className="divide-y divide-slate-100 border-t border-slate-100">
                {recentDownloads.map((item) => (
                  <div
                    key={item.id}
                    className="py-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {item.title}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5 tabular-nums">
                        <span>{item.platform}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {item.container} {item.qualityLabel}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{item.sizeFormatted}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setUrlInput(item.sourceUrl);
                        analyzeUrl(item.sourceUrl);
                      }}
                      className="min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 hover:border-[#16a34a] text-xs font-semibold text-slate-700 hover:text-[#16a34a] flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>{lang === 'ml' ? 'വീണ്ടും എടുക്കുക' : 'Load Again'}</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Clean Quiet Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <span>Online Video &amp; Music Downloader · MP4 · 3GP · Video-Only · MP3</span>
          <span>Save only public content you have permission to download.</span>
        </div>
      </footer>
    </div>
  );
}

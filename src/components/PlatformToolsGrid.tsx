import React from 'react';
import {
  ArrowRight,
  PlaySquare,
  Smartphone,
  Music,
  Camera,
  VolumeX,
  Film,
} from 'lucide-react';
import type { FormatCategory } from '../types';

export interface ToolPreset {
  id: string;
  titleEn: string;
  titleMl: string;
  subtitle: string;
  filter: 'all' | FormatCategory;
  placeholder: string;
  iconBg: string;
  iconColor: string;
  Icon: React.ComponentType<{ className?: string }>;
}

export const TOOL_PRESETS: ToolPreset[] = [
  {
    id: 'yt-video',
    titleEn: 'YouTube Video Downloader',
    titleMl: 'YouTube വീഡിയോ ഡൗൺലോഡർ',
    subtitle: 'MP4 1080P · 720P · 360P · 3GP',
    filter: 'video',
    placeholder: 'Paste YouTube video link here...',
    iconBg: 'bg-red-50',
    iconColor: 'text-red-600',
    Icon: PlaySquare,
  },
  {
    id: 'yt-shorts',
    titleEn: 'YouTube Shorts Downloader',
    titleMl: 'YouTube Shorts ഡൗൺലോഡർ',
    subtitle: 'HD Vertical MP4 · Direct to Gallery',
    filter: 'video',
    placeholder: 'Paste YouTube Shorts link here...',
    iconBg: 'bg-rose-50',
    iconColor: 'text-rose-600',
    Icon: Smartphone,
  },
  {
    id: 'ig-reels',
    titleEn: 'Instagram Reels & Video',
    titleMl: 'Instagram റീൽസ് & വീഡിയോ',
    subtitle: 'Reels · Posts · HD MP4 & MP3',
    filter: 'all',
    placeholder: 'Paste Instagram Reel or Post link...',
    iconBg: 'bg-pink-50',
    iconColor: 'text-pink-600',
    Icon: Camera,
  },
  {
    id: 'mp3-music',
    titleEn: 'Video to MP3 Music Only',
    titleMl: 'മ്യൂസിക് മാത്രം (MP3 Audio)',
    subtitle: '320KBPS · 256KBPS · 128KBPS · 48KBPS',
    filter: 'music',
    placeholder: 'Paste video link to extract MP3 audio...',
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-600',
    Icon: Music,
  },
  {
    id: 'video-only',
    titleEn: 'Video Only (Muted MP4)',
    titleMl: 'വീഡിയോ മാത്രം (ശബ്ദമില്ലാതെ)',
    subtitle: 'Clean Video Track · 1080P · 720P · 360P',
    filter: 'video_only',
    placeholder: 'Paste link for muted video-only download...',
    iconBg: 'bg-sky-50',
    iconColor: 'text-sky-600',
    Icon: VolumeX,
  },
  {
    id: '3gp-mobile',
    titleEn: '3GP & All Social Downloader',
    titleMl: '3GP & സോഷ്യൽ മീഡിയ ഡൗൺലോഡർ',
    subtitle: 'TikTok · Facebook · X · 3GP 240P & 144P',
    filter: 'video',
    placeholder: 'Paste TikTok, Facebook, X, or video link...',
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
    Icon: Film,
  },
];

interface PlatformToolsGridProps {
  selectedPresetId: string;
  lang: 'en' | 'ml';
  onSelectPreset: (preset: ToolPreset) => void;
}

export const PlatformToolsGrid: React.FC<PlatformToolsGridProps> = ({
  selectedPresetId,
  lang,
  onSelectPreset,
}) => {
  return (
    <section id="tools" className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-2">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            {lang === 'ml' ? 'ഡൗൺലോഡ് ഫോർമാറ്റുകളും ടൂളുകളും' : 'Supported Formats & Download Tools'}
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            {lang === 'ml'
              ? 'ഏത് സോഷ്യൽ മീഡിയ ലിങ്കും പേസ്റ്റ് ചെയ്ത് ഫോൺ ഗാലറിയിലേക്ക് നേരിട്ട് സേവ് ചെയ്യാം'
              : 'Select a tool below to pre-configure your preferred output mode'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {TOOL_PRESETS.map((tool) => {
          const IconComponent = tool.Icon;
          const isSelected = selectedPresetId === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              onClick={() => onSelectPreset(tool)}
              className={`w-full min-h-[76px] p-4 rounded-2xl bg-white border text-left flex items-center justify-between gap-4 transition-all cursor-pointer active:scale-[0.99] ${
                isSelected
                  ? 'border-[#16a34a] ring-1 ring-[#16a34a]/30'
                  : 'border-slate-200/90 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div
                  className={`w-12 h-12 rounded-xl ${tool.iconBg} ${tool.iconColor} flex items-center justify-center shrink-0`}
                >
                  <IconComponent className="w-6 h-6" />
                </div>
                <div className="min-w-0">
                  <div className="text-base font-bold text-slate-900 truncate">
                    {lang === 'ml' ? tool.titleMl : tool.titleEn}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 truncate">
                    {tool.subtitle}
                  </div>
                </div>
              </div>

              <ArrowRight className="w-5 h-5 text-[#16a34a] shrink-0" />
            </button>
          );
        })}
      </div>
    </section>
  );
};

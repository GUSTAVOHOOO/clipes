import type { KeptSegment } from '@/features/editor/timelineMath';

export type CaptionStyle = { schemaVersion: 1; revision: number; preset: 'vertical' | 'cinema' | 'simple'; font: 'Noto Sans' | 'Noto Serif'; fontSize: number; color: string; activeColor: string; dimColor: string; outlineColor: string; outline: number; shadow: number; x: number; y: number; highlight: boolean };
export type WordOverride = { color?: string; activeColor?: string; highlight?: boolean; hidden?: boolean };
export type MissingGlyph = { position: number; sentence_id?: number | null; word: string; char: string; codepoint: string; start_us: number };
export type EditableWord = { position: number; text: string; startUs: number; endUs: number; sourceStartUs?: number; overrides: WordOverride; missingGlyph?: MissingGlyph | null };
export type CaptionWord = { position: number; text: string; startUs: number; endUs: number; color: string; activeColor: string; highlight: boolean };
export type CaptionTrack = 'narration' | 'original' | 'translated';
export type NarrationSummary = { hasNarration: boolean; alignedBlocks: number; pendingBlocks: number; needsReviewBlocks: number; staleBlocks: number };
export type CaptionCue = { startUs: number; endUs: number; lines: CaptionWord[][] };
export type CaptionData = { style: CaptionStyle; cues: CaptionCue[]; emojiRemoved: number; words: EditableWord[]; transcriptId: number; start_us: number; end_us: number; durationUs?: number; segments?: KeptSegment[]; missingGlyphs?: MissingGlyph[]; track?: CaptionTrack; availableTracks?: CaptionTrack[]; narrationSummary?: NarrationSummary | null };

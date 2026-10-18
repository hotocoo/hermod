/** WebVTT generation and checks (pure), plus the object URL a `<track>` needs. */

export interface Chapter { t: number; title: string }
export interface Cue { start: number; end: number; text: string }

export function vttTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`;
}

/** Cue text may not contain `-->` or markup start characters, and no blank lines. */
const clean = (s: string): string => s.replace(/\r?\n+/g, ' ').replace(/-->/g, '->').replace(/&/g, '&amp;').replace(/</g, '&lt;').trim();

/** Chapters (post.create `chapters`) as a chapters track. Each cue runs to the next chapter; the last to `duration`. */
export function chaptersVtt(chapters: readonly Chapter[], duration: number): string {
  const sorted = [...chapters].filter((c) => Number.isFinite(c.t) && c.t >= 0 && c.title.trim()).sort((a, b) => a.t - b.t);
  const lines = ['WEBVTT', ''];
  sorted.forEach((c, i) => {
    const end = sorted[i + 1]?.t ?? Math.max(duration, c.t + 1);
    if (end <= c.t) return;
    lines.push(`${i + 1}`, `${vttTime(c.t)} --> ${vttTime(end)}`, clean(c.title), '');
  });
  return lines.join('\n');
}

export function captionsVtt(cues: readonly Cue[]): string {
  const lines = ['WEBVTT', ''];
  cues.filter((c) => c.end > c.start && c.text.trim()).sort((a, b) => a.start - b.start).forEach((c, i) => {
    lines.push(`${i + 1}`, `${vttTime(c.start)} --> ${vttTime(c.end)}`, clean(c.text), '');
  });
  return lines.join('\n');
}

/** SRT (the common caption export) to WebVTT: header added, comma decimals become dots. */
export function srtToVtt(srt: string): string {
  const body = srt.replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return `WEBVTT\n\n${body.trim()}\n`;
}

/** True when `text` looks like a WebVTT file with at least one cue timing line. */
export const isVtt = (text: string): boolean => /^﻿?WEBVTT/.test(text) && /\d{2}:\d{2}(:\d{2})?\.\d{3}\s+-->\s+\d{2}:\d{2}(:\d{2})?\.\d{3}/.test(text);

/** Object URL for `<track src>`. Call `revoke` when the player unmounts. */
export function vttTrackUrl(vtt: string): { url: string; revoke: () => void } {
  const url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
  return { url, revoke: () => URL.revokeObjectURL(url) };
}

/** Chapter lines as people type them: `m:ss Title` or `h:mm:ss Title`, one per line. Lines that do not parse are skipped. */
export function parseChapters(text: string): Chapter[] {
  const out: Chapter[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s*(?:(\d+):)?(\d{1,2}):(\d{2})\s+(.+?)\s*$/.exec(line);
    if (m) out.push({ t: Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]), title: m[4] });
  }
  return out;
}

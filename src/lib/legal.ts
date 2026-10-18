/** Bundled legal texts (legal/*.md, shared with the website) and their versions. */
import terms from '../../legal/TERMS.md';
import privacy from '../../legal/PRIVACY.md';

export interface LegalDoc { title: string; version: string; body: string }

function parse(raw: string): LegalDoc {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  const field = (k: string) => new RegExp(`${k}: "?([^"\\n]+)"?`).exec(m?.[1] ?? '')?.[1] ?? '';
  return { title: field('title'), version: field('version'), body: m ? raw.slice(m[0].length) : raw };
}

export const TERMS = parse(terms);
export const PRIVACY = parse(privacy);
/** What the core stores as the accepted version; any change to either text re-prompts. */
export const LEGAL_VERSION = `${TERMS.version}+${PRIVACY.version}`;

/** A blob is addressed by its lowercase 64-hex BLAKE3 hash. Anything else (peer-supplied) never reaches a URL. */
export const isBlobHash = (hash: string): boolean => /^[0-9a-f]{64}$/.test(hash);

/** CSS `url("...")` for an already-validated URL, quoted so it cannot break out; undefined for an empty one. */
export const cssUrl = (url: string): string | undefined => (url ? `url("${url.replace(/["\\\n\r]/g, '')}")` : undefined);

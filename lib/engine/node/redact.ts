/**
 * Redaction for external-engine output.
 *
 * calibre/pandoc/tesseract print absolute paths (and our job UUID directory)
 * into stderr. That text ends up in API warnings and error hints, so it must
 * never leak the server's filesystem layout or a user's home directory. We keep
 * the file's own name — `<job>/input.epub` is useful, `/var/folders/...` is not.
 */

const JOB_MARKER = '<job>';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lastSegment(path: string): string {
  const clean = path.replace(/^file:\/\//i, '').replace(/[\\/]+$/, '');
  const parts = clean.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

function replaceWithMarker(match: string): string {
  const name = lastSegment(match);
  return name ? `${JOB_MARKER}/${name}` : JOB_MARKER;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Replace absolute paths / `file://` URLs / job UUIDs with `<job>`, keeping only
 * the basename. Safe to call on arbitrary stderr text.
 */
export function redactEngineOutput(text: string, tempDir?: string): string {
  if (!text) return '';
  let out = text;

  // 1. file:// URLs first (they may wrap any of the roots below).
  out = out.replace(/file:\/\/[^\s"')]+/gi, replaceWithMarker);

  // 2. The exact temp directory this run created, plus anything under it.
  if (tempDir) {
    const dirPattern = escapeRegExp(tempDir).replace(/\\/g, '[\\\\/]');
    out = out.replace(new RegExp(`${dirPattern}(?:[\\\\/][^\\s"')]*)?`, 'gi'), replaceWithMarker);
  }

  // 3. Well-known temp / home roots, for paths that come from inside the engine.
  out = out.replace(/(?:\/private)?\/(?:var\/folders|tmp|var\/tmp)\/[^\s"')]+/g, replaceWithMarker);
  out = out.replace(/(?:\/Users|\/home)\/[^\s"')]+/g, replaceWithMarker);
  out = out.replace(/[A-Za-z]:\\[^\s"')]+/g, replaceWithMarker);

  // 4. Bare job ids (uuid v4 shaped).
  out = out.replace(UUID_RE, JOB_MARKER);

  // 5. Collapse accidental repeats like `<job>/<job>/input.epub`.
  out = out.replace(/(?:<job>[\\/])+<job>/g, `${JOB_MARKER}/`);
  out = out.replace(/<job>\/<job>/g, `${JOB_MARKER}/`);

  return out;
}

export { JOB_MARKER };

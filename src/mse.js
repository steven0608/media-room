// Play a fragmented-MP4 stream from the hub in an <audio>/<video> element using MediaSource.
// Used over the "connect anywhere" link, where media arrives through the data channel instead
// of a URL the element could load by itself. The result is a blob: URL, so it counts as the
// page's own media: the music visualizer and the video texture keep working.
const BEHIND = 30;   // seconds of already-played media to keep (lets you rewind a little)
const AHEAD = 90;    // stop reading the stream when this much is buffered ahead

export function playStream(el, path, mime, { duration } = {}) {
  const ms = new MediaSource();
  const url = URL.createObjectURL(ms);
  let reader = null;
  let stopped = false;
  el.src = url;

  const stop = () => {
    stopped = true;
    try { reader?.cancel(); } catch { /* done */ }
    URL.revokeObjectURL(url);
  };

  ms.addEventListener('sourceopen', async () => {
    let sb;
    try {
      sb = ms.addSourceBuffer(mime);
      if (duration && Number.isFinite(duration)) ms.duration = duration;
    } catch (e) {
      el.dispatchEvent(new CustomEvent('streamerror', { detail: e.message }));
      return;
    }
    const idle = () => (sb.updating ? new Promise((r) => sb.addEventListener('updateend', r, { once: true })) : Promise.resolve());
    const append = async (chunk) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await idle();
        try { sb.appendBuffer(chunk); return; } catch (e) {
          if (e.name !== 'QuotaExceededError') throw e;
          // memory full: drop what's already been played and try again
          const cut = el.currentTime - BEHIND;
          if (cut <= 0) await new Promise((r) => setTimeout(r, 1000));
          else { await idle(); sb.remove(0, cut); }
        }
      }
    };
    try {
      const res = await fetch(path);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      reader = res.body.getReader();
      let pendingBytes = [];
      let pendingSize = 0;
      for (;;) {
        if (stopped) return;
        // don't run too far ahead of playback (keeps memory small for long films)
        const b = sb.buffered;
        while (!stopped && b.length && b.end(b.length - 1) - el.currentTime > AHEAD) {
          await new Promise((r) => setTimeout(r, 1000));
          if (el.currentTime > BEHIND + 5) { await idle(); try { sb.remove(0, el.currentTime - BEHIND); } catch { /* busy */ } }
        }
        const { value, done } = await reader.read();
        if (done) break;
        pendingBytes.push(value);
        pendingSize += value.length;
        // append in ~256 KB batches: fewer, bigger appends are smoother
        if (pendingSize >= 256 * 1024) {
          const merged = concat(pendingBytes, pendingSize);
          pendingBytes = []; pendingSize = 0;
          await append(merged);
        }
      }
      if (pendingSize && !stopped) await append(concat(pendingBytes, pendingSize));
      await idle();
      if (!stopped && ms.readyState === 'open') ms.endOfStream();
    } catch (e) {
      if (!stopped) el.dispatchEvent(new CustomEvent('streamerror', { detail: e.message }));
    }
  }, { once: true });

  return { stop };
}

function concat(parts, size) {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export const AUDIO_MIME = 'audio/mp4; codecs="mp4a.40.2"';

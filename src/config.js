// Everything worth tweaking lives here. Distances are metres, angles degrees.
export const CONFIG = {
  // "Connect anywhere": the meeting point the public room page uses to find your hub.
  // Filled in when the meeting point is deployed (see signal/). Empty = home-network only.
  remote: { signal: 'https://media-room-signal.media-room-signal.workers.dev' },

  // Where you sit: the deck's centre, eye height for the desktop preview.
  seatedEyeHeight: 1.2,

  // The big curved screen across the water (cinema, track display, karaoke lyrics).
  screen: {
    radius: 9.5,        // distance from your head
    arcDegrees: 44,     // how wide it looks (Meta/UX review: ~40–50° is comfortable)
    centerY: 1.8,       // centre height — floats ~0.4 m above the water, ~3° above eye level
  },
  waterY: -0.6,
  deckRadius: 3.0,

  // Tide visualizer (the lake surface reacts to the music)
  tide: {
    swell: 0.55,        // how high the bass swells get
    rippleSpeed: 7.5,   // m/s for beat rings
    rippleLife: 4.0,    // seconds a ring is visible
  },

  // Beat detector: a beat fires when bass "flux" beats its recent median by this ratio
  beat: { ratio: 1.45, minGapMs: 140 },

  // Colours (sRGB hex) — the night-lake palette from the creative review
  palette: {
    skyTop: 0x0b1026,
    skyHorizon: 0x1c2550,
    water: 0x05070f,
    moon: 0xcfd8ff,
    amber: 0xffb35c,
    coral: 0xff6f61,
    cyan: 0x5ce1e6,
    magenta: 0xff4fa3,
    wood: 0x3a2a22,
    text: 0xe8ecff,
  },

  // Comfort
  snapTurnDegrees: 45,
  frameRate: { cinema: 72, other: 90 }, // 72 = 3 × 24 fps films; 90 for smoother motion elsewhere
};

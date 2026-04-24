// Remix.js — meme editor
// Features:
//   1. Pick any player from the app (search), loads their photo as base image
//   2. OR upload your own image (5 MB limit, auto-downscaled if > 2000px)
//   3. Click an emoji palette item → places it on the canvas
//   4. Drag to move any placed emoji
//   5. Drag the bottom-right corner to resize
//   6. Tap an emoji + "Delete" to remove it
//   7. Export as PNG download, or copy PNG to clipboard
//
// Implementation notes:
//   - Uses DOM + <img> + absolutely positioned <div> emoji overlays.
//     Web-only — gated on Platform.OS === 'web'. Other platforms show
//     a "web only" stub.
//   - On export, stamps base image + each emoji into an off-screen
//     canvas at the image's native resolution so Discord gets crisp output.
//   - Cross-origin images (Wikipedia/NHL CDN) need `crossOrigin="anonymous"`
//     at load time. If the CDN doesn't support it, the canvas becomes
//     "tainted" and toBlob throws. We handle that error gracefully and
//     tell the user to try upload instead.

import React, { useRef, useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, Platform, TextInput, Image } from 'react-native';
import { resolveBestHockeyMatch } from './PlayerPhoto';

const EMOJI_PALETTE = ['👑','🤡','🔥','💀','😭','💩','🗑️','❌','🤮','🥱','📉','⬆️','👎','🫠','🎯','💧','🍆'];

// Custom image stickers. Each entry has { id, label, source }.
// Rendered in the palette after text emojis; placed as <img>/canvas bitmap
// instead of a text glyph.
let PETEY_STICKER_SOURCE = null;
try {
  // eslint-disable-next-line global-require
  PETEY_STICKER_SOURCE = require('./assets/petey.png');
} catch (e) {
  try {
    // eslint-disable-next-line global-require
    PETEY_STICKER_SOURCE = require('./assets/petey.jpg');
  } catch (e2) {
    PETEY_STICKER_SOURCE = null;
  }
}
const IMAGE_STICKERS = PETEY_STICKER_SOURCE
  ? [{ id: 'petey', label: 'PeteyBOI', source: PETEY_STICKER_SOURCE }]
  : [];

// Upload limits
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_DIMENSION = 2000; // downscale anything wider/taller

export default function Remix({
  theme,
  playerDatabase,
  goalieDatabase,
  draftLookup,
  calculateTRUEi,
  assignRoleTier,
  tierToLineLabel,
}) {
  const [baseImageUrl, setBaseImageUrl] = useState(null);
  const [baseImageDims, setBaseImageDims] = useState({ w: 0, h: 0 });
  const [emojis, setEmojis] = useState([]); // [{id, char, x, y, size}]
  const [selectedId, setSelectedId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [loadingPhoto, setLoadingPhoto] = useState(false);
  // The player currently loaded via search (null when user uploaded an
  // image manually or no base image is set). Drives the stats banner.
  const [loadedPlayer, setLoadedPlayer] = useState(null); // { name, isGoalie, seasonStats, season }
  const [showStatsBanner, setShowStatsBanner] = useState(false);

  const containerRef = useRef(null);
  const imgRef = useRef(null);

  // ---------- Player search ----------
  // Combine skater + goalie names, de-duplicate.
  const allPlayerNames = useMemo(() => {
    const set = new Set();
    (playerDatabase || []).forEach(p => p.name && set.add(p.name));
    (goalieDatabase || []).forEach(g => g.name && set.add(g.name));
    return [...set].sort();
  }, [playerDatabase, goalieDatabase]);

  const filteredPlayers = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return allPlayerNames
      .filter(n => n.toLowerCase().includes(q))
      .slice(0, 15);
  }, [searchQuery, allPlayerNames]);

  // Find the latest-season stat row for the given player name.
  // Checks skater DB first, then goalie DB. Returns { isGoalie, row } or null.
  const findLatestStats = (name) => {
    const low = name.toLowerCase().trim();
    // Skater: group rows by name, pick most recent regular-season row
    const skaterRows = (playerDatabase || []).filter(p =>
      (p.name || '').toLowerCase().trim() === low &&
      (p.seasonType || 'regular') !== 'playoffs'
    );
    if (skaterRows.length > 0) {
      skaterRows.sort((a, b) => String(b.season || '').localeCompare(String(a.season || '')));
      return { isGoalie: false, row: skaterRows[0] };
    }
    const goalieRows = (goalieDatabase || []).filter(g =>
      (g.name || '').toLowerCase().trim() === low &&
      (g.seasonType || 'regular') !== 'playoffs'
    );
    if (goalieRows.length > 0) {
      goalieRows.sort((a, b) => String(b.season || '').localeCompare(String(a.season || '')));
      return { isGoalie: true, row: goalieRows[0] };
    }
    return null;
  };

  // Format the season for display: "2024-25" stays, "2024-2025" → "2024-25"
  const formatSeason = (season) => {
    if (!season) return '';
    if (/^\d{4}-\d{2}$/.test(season)) return season;
    const m = String(season).match(/^(\d{4})-(\d{4})$/);
    if (!m) return season;
    return `${m[1]}-${m[2].slice(2)}`;
  };

  // Build the stat banner text string for a loaded player.
  // Skater: "Name · 2028-29 · 72GP 32-48-80 · TRUEi 97 · L1"
  // Goalie: "Name · 2028-29 · 42GP · SV% .916 · GAA 2.47 · GSAA 12.3"
  const buildBannerText = (lp) => {
    if (!lp || !lp.row) return '';
    const r = lp.row;
    const season = formatSeason(r.season || '');
    if (lp.isGoalie) {
      const gp = r.gp != null ? `${r.gp}GP` : '';
      const svPct = r.svPct != null ? `SV% .${String(Math.round(r.svPct * 1000)).padStart(3, '0')}` : '';
      const gaa = r.gaa != null ? `GAA ${r.gaa.toFixed(2)}` : '';
      const gsaa = r.gsaa != null ? `GSAA ${r.gsaa.toFixed(1)}` : '';
      return [lp.name, season, gp, svPct, gaa, gsaa].filter(Boolean).join(' · ');
    } else {
      const gp = r.gp != null ? `${r.gp}GP` : '';
      const line = r.g != null && r.a != null
        ? `${r.g}-${r.a}-${(r.g || 0) + (r.a || 0)}`
        : '';
      let trueiStr = '';
      if (calculateTRUEi) {
        const v = parseFloat(calculateTRUEi(r));
        if (!Number.isNaN(v)) trueiStr = `TRUEi ${Math.round(v)}`;
      }
      let tierStr = '';
      if (assignRoleTier && tierToLineLabel) {
        const t = assignRoleTier(r, playerDatabase || []);
        if (t) tierStr = tierToLineLabel(t);
      }
      return [lp.name, season, gp, line, trueiStr, tierStr].filter(Boolean).join(' · ');
    }
  };

  const loadPlayerPhoto = async (name) => {
    setLoadingPhoto(true);
    setStatusMessage('');
    try {
      const result = await resolveBestHockeyMatch(name, draftLookup, true);
      if (result?.url) {
        resetCanvas();
        setBaseImageUrl(result.url);
        setShowSearch(false);
        setSearchQuery('');
        // Look up their most recent stat row so we can offer the banner
        const found = findLatestStats(name);
        if (found) {
          setLoadedPlayer({ name, isGoalie: found.isGoalie, row: found.row });
        } else {
          setLoadedPlayer(null);
        }
      } else {
        setStatusMessage(`No photo available for ${name}. Try uploading an image instead.`);
      }
    } catch (e) {
      setStatusMessage('Failed to load photo. Try another player or upload an image.');
    }
    setLoadingPhoto(false);
  };

  // ---------- File upload ----------
  const handleFileUpload = () => {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/jpg,image/webp';
    input.onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (file.size > MAX_FILE_BYTES) {
        setStatusMessage(`File too big (${(file.size / 1024 / 1024).toFixed(1)} MB). Max is 5 MB.`);
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result;
        // If image is larger than MAX_DIMENSION, downscale
        const img = new window.Image();
        img.onload = () => {
          const maxSide = Math.max(img.width, img.height);
          if (maxSide <= MAX_DIMENSION) {
            resetCanvas();
            setBaseImageUrl(dataUrl);
            return;
          }
          const scale = MAX_DIMENSION / maxSide;
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resetCanvas();
          setBaseImageUrl(canvas.toDataURL('image/png'));
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const resetCanvas = () => {
    setEmojis([]);
    setSelectedId(null);
    setStatusMessage('');
    setLoadedPlayer(null);
    setShowStatsBanner(false);
  };

  // ---------- Emoji placement ----------
  // An "emoji" in our state can be either a text glyph OR an image sticker:
  //   { id, x, y, size, rotation, char }        (text emoji)
  //   { id, x, y, size, rotation, imageSrc }    (image sticker like PeteyBOI)
  const addEmoji = (payload) => {
    if (!baseImageUrl) {
      setStatusMessage('Pick a player or upload an image first.');
      return;
    }
    const id = `e${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
    const defaultSize = Math.round(Math.max(40, baseImageDims.w * 0.15));
    const x = (baseImageDims.w || 400) / 2 - defaultSize / 2;
    const y = (baseImageDims.h || 400) / 2 - defaultSize / 2;
    const newItem = { id, x, y, size: defaultSize, rotation: 0 };
    // payload can be a string (text emoji) or { imageSrc } for a sticker
    if (typeof payload === 'string') {
      newItem.char = payload;
    } else if (payload && payload.imageSrc) {
      newItem.imageSrc = payload.imageSrc;
    } else {
      return;
    }
    setEmojis(prev => [...prev, newItem]);
    setSelectedId(id);
  };

  const updateEmoji = (id, patch) => {
    setEmojis(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setEmojis(prev => prev.filter(e => e.id !== selectedId));
    setSelectedId(null);
  };

  // ---------- Drag / resize / rotate with refs for reliability ----------
  // Using refs instead of state-in-useEffect means the handlers always
  // see the latest emoji list without re-binding listeners on every update.
  const emojisRef = useRef(emojis);
  const baseImageDimsRef = useRef(baseImageDims);
  useEffect(() => { emojisRef.current = emojis; }, [emojis]);
  useEffect(() => { baseImageDimsRef.current = baseImageDims; }, [baseImageDims]);

  const dragStateRef = useRef(null);

  // Convert screen coordinates → image pixel coordinates
  const screenToImage = (clientX, clientY) => {
    const img = imgRef.current;
    const dims = baseImageDimsRef.current;
    if (!img || !dims.w) return { x: 0, y: 0 };
    const rect = img.getBoundingClientRect();
    const scale = dims.w / rect.width;
    return {
      x: (clientX - rect.left) * scale,
      y: (clientY - rect.top) * scale,
    };
  };

  const handlePointerDownOnEmoji = (ev, emoji, mode /* 'move' | 'resize' | 'rotate' */) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.currentTarget && ev.currentTarget.setPointerCapture) {
      try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch(e) {}
    }
    setSelectedId(emoji.id);
    const startPt = screenToImage(ev.clientX, ev.clientY);
    // For rotation we need the current angle from center
    const centerX = emoji.x + emoji.size / 2;
    const centerY = emoji.y + emoji.size / 2;
    const startAngle = Math.atan2(startPt.y - centerY, startPt.x - centerX);
    dragStateRef.current = {
      id: emoji.id,
      mode,
      startPoint: startPt,
      startEmoji: { ...emoji },
      centerX,
      centerY,
      startAngle,
    };

    const onMove = (moveEv) => {
      const ds = dragStateRef.current;
      if (!ds) return;
      const cur = screenToImage(moveEv.clientX, moveEv.clientY);
      if (ds.mode === 'move') {
        updateEmoji(ds.id, {
          x: ds.startEmoji.x + (cur.x - ds.startPoint.x),
          y: ds.startEmoji.y + (cur.y - ds.startPoint.y),
        });
      } else if (ds.mode === 'resize') {
        // Distance from center — scale proportionally
        const dist = Math.hypot(cur.x - ds.centerX, cur.y - ds.centerY);
        const startDist = Math.hypot(ds.startPoint.x - ds.centerX, ds.startPoint.y - ds.centerY);
        const ratio = startDist > 0 ? (dist / startDist) : 1;
        const newSize = Math.max(20, Math.round(ds.startEmoji.size * ratio));
        updateEmoji(ds.id, { size: newSize });
      } else if (ds.mode === 'rotate') {
        const angle = Math.atan2(cur.y - ds.centerY, cur.x - ds.centerX);
        const delta = angle - ds.startAngle;
        const rotDeg = (ds.startEmoji.rotation || 0) + delta * 180 / Math.PI;
        updateEmoji(ds.id, { rotation: rotDeg });
      }
    };
    const onUp = () => {
      dragStateRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // ---------- Export ----------
  const exportPNG = async (mode /* 'download' | 'clipboard' */) => {
    if (!baseImageUrl) {
      setStatusMessage('Nothing to export — pick or upload an image first.');
      return;
    }
    const img = imgRef.current;
    if (!img || !baseImageDims.w) {
      setStatusMessage('Image not fully loaded yet, try again in a second.');
      return;
    }
    try {
      const canvas = document.createElement('canvas');
      canvas.width = baseImageDims.w;
      canvas.height = baseImageDims.h;
      const ctx = canvas.getContext('2d');
      // Reload with crossOrigin for canvas-safe drawing
      await new Promise((resolve, reject) => {
        const off = new window.Image();
        off.crossOrigin = 'anonymous';
        off.onload = () => { ctx.drawImage(off, 0, 0, canvas.width, canvas.height); resolve(); };
        off.onerror = () => reject(new Error('image load failed'));
        off.src = baseImageUrl;
      });
      // Stamp emojis — each rendered to a temp canvas first so we can
      // measure the ACTUAL rendered size (emoji widths/heights vary a lot
      // between characters and fonts). Then we draw that bitmap at the
      // correct position and rotation on the main canvas. This makes the
      // export match what's on screen.
      const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Android Emoji",sans-serif';
      // Helper: load an image source (possibly a require() object or URL)
      // into an HTMLImageElement we can drawImage from.
      const loadImage = (src) => new Promise((resolve, reject) => {
        const im = new window.Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => resolve(im);
        im.onerror = (err) => reject(err);
        im.src = typeof src === 'string' ? src : (src.uri || src.default || src);
      });
      for (const e of emojis) {
        const cx = e.x + e.size / 2;
        const cy = e.y + e.size / 2;
        if (e.imageSrc) {
          // Image sticker — draw scaled + rotated around its center.
          try {
            const im = await loadImage(e.imageSrc);
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(((e.rotation || 0) * Math.PI) / 180);
            ctx.drawImage(im, -e.size / 2, -e.size / 2, e.size, e.size);
            ctx.restore();
          } catch (err) {
            // Image failed to load — skip this sticker silently
          }
          continue;
        }
        // Text emoji — render to temp canvas for correct size/position
        const pad = 8;
        const renderSize = Math.max(40, e.size * 2); // 2x oversampling
        const tmp = document.createElement('canvas');
        tmp.width = renderSize + pad * 2;
        tmp.height = renderSize + pad * 2;
        const tctx = tmp.getContext('2d');
        tctx.font = `${renderSize}px ${EMOJI_FONT}`;
        tctx.textBaseline = 'middle';
        tctx.textAlign = 'center';
        tctx.fillText(e.char, tmp.width / 2, tmp.height / 2);
        const scaleRatio = e.size / renderSize;
        const drawW = tmp.width * scaleRatio;
        const drawH = tmp.height * scaleRatio;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(((e.rotation || 0) * Math.PI) / 180);
        ctx.drawImage(tmp, -drawW / 2, -drawH / 2, drawW, drawH);
        ctx.restore();
      }

      // Stats banner — draw last so it sits on top of the image + under
      // nothing else. Mirrors the on-screen gradient + text style.
      if (showStatsBanner && loadedPlayer) {
        const bannerText = buildBannerText(loadedPlayer);
        if (bannerText) {
          const imgH = canvas.height;
          const imgW = canvas.width;
          // Height ~8% of image, with sensible min/max
          const bandH = Math.max(36, Math.min(80, Math.round(imgH * 0.10)));
          // Gradient from transparent at top to ~90% black at bottom
          const grad = ctx.createLinearGradient(0, imgH - bandH, 0, imgH);
          grad.addColorStop(0, 'rgba(0,0,0,0)');
          grad.addColorStop(0.5, 'rgba(0,0,0,0.75)');
          grad.addColorStop(1, 'rgba(0,0,0,0.9)');
          ctx.fillStyle = grad;
          ctx.fillRect(0, imgH - bandH, imgW, bandH);
          // Text — size ~40% of band height, auto-shrink if too wide
          let fontSize = Math.round(bandH * 0.4);
          ctx.font = `600 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
          let textWidth = ctx.measureText(bannerText).width;
          const maxW = imgW - 24;
          if (textWidth > maxW) {
            // Scale down to fit
            const shrink = maxW / textWidth;
            fontSize = Math.max(10, Math.floor(fontSize * shrink));
            ctx.font = `600 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
          }
          ctx.fillStyle = '#fff';
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';
          // Text shadow for legibility over bright photo regions
          ctx.shadowColor = 'rgba(0,0,0,0.9)';
          ctx.shadowBlur = 4;
          ctx.shadowOffsetY = 1;
          ctx.fillText(bannerText, 12, imgH - bandH / 2);
          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0;
          ctx.shadowOffsetY = 0;
        }
      }
      // Try exporting — can throw on tainted canvas
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob returned null')), 'image/png');
      });
      if (mode === 'download') {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `remix-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setStatusMessage('Downloaded!');
      } else {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        setStatusMessage('Copied to clipboard — paste into Discord.');
      }
    } catch (err) {
      const msg = String(err && err.message || err);
      if (msg.includes('tainted') || msg.includes('SecurityError') || msg.includes('image load failed')) {
        setStatusMessage('Export blocked — this image source doesn\'t allow remixing. Try uploading the photo instead.');
      } else {
        setStatusMessage('Export failed: ' + msg);
      }
    }
  };

  // ---------- Render ----------
  if (Platform.OS !== 'web') {
    return (
      <View style={{ padding: 20 }}>
        <Text style={{ color: theme.text }}>Remix is web-only.</Text>
      </View>
    );
  }

  const bgCard = theme.bgCard || '#fff';
  const accent = theme.accentBlue || '#1976d2';
  const text = theme.text;
  const border = theme.border || '#ddd';

  return (
    <View style={{ padding: 16 }}>
      <Text style={{ color: text, fontSize: 22, fontWeight: '700', marginBottom: 4 }}>🎨 Remix</Text>
      <Text style={{ color: theme.textSecondary, fontSize: 12, marginBottom: 14 }}>
        Pick a player or upload a photo, then stamp emojis. Tap an emoji to select it — blue handle resizes, green handle rotates, drag anywhere else to move.
      </Text>

      {/* Source controls */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <TouchableOpacity
          onPress={() => setShowSearch(v => !v)}
          style={{ backgroundColor: accent, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 }}
        >
          <Text style={{ color: '#fff', fontWeight: '600', fontSize: 13 }}>
            {showSearch ? '✕ Close search' : '🔍 Pick a player'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleFileUpload}
          style={{ backgroundColor: accent, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 }}
        >
          <Text style={{ color: '#fff', fontWeight: '600', fontSize: 13 }}>📁 Upload image</Text>
        </TouchableOpacity>
        {baseImageUrl ? (
          <TouchableOpacity
            onPress={() => { setBaseImageUrl(null); resetCanvas(); }}
            style={{ backgroundColor: theme.danger || '#c62828', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 }}
          >
            <Text style={{ color: '#fff', fontWeight: '600', fontSize: 13 }}>🗑 Clear</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Search input */}
      {showSearch ? (
        <View style={{ marginBottom: 12 }}>
          <TextInput
            placeholder="Search any player..."
            placeholderTextColor={theme.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
            style={{
              backgroundColor: bgCard, color: text,
              borderWidth: 1, borderColor: border,
              paddingHorizontal: 12, paddingVertical: 8,
              borderRadius: 6, fontSize: 14,
            }}
          />
          {filteredPlayers.length > 0 ? (
            <View style={{ backgroundColor: bgCard, borderWidth: 1, borderColor: border, borderRadius: 6, marginTop: 4, maxHeight: 250 }}>
              {filteredPlayers.map(name => (
                <TouchableOpacity
                  key={name}
                  onPress={() => loadPlayerPhoto(name)}
                  style={{ paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.borderLight || '#eee' }}
                >
                  <Text style={{ color: text, fontSize: 13 }}>{name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : searchQuery.trim() ? (
            <Text style={{ color: theme.textSecondary, fontSize: 12, marginTop: 6 }}>No matches</Text>
          ) : null}
        </View>
      ) : null}

      {statusMessage ? (
        <View style={{ padding: 10, backgroundColor: bgCard, borderLeftWidth: 3, borderLeftColor: accent, marginBottom: 10, borderRadius: 4 }}>
          <Text style={{ color: text, fontSize: 12 }}>{statusMessage}</Text>
        </View>
      ) : null}
      {loadingPhoto ? (
        <Text style={{ color: theme.textSecondary, fontSize: 12, marginBottom: 10 }}>Loading photo…</Text>
      ) : null}

      {/* Emoji palette */}
      {baseImageUrl ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12, padding: 8, backgroundColor: bgCard, borderRadius: 8, borderWidth: 1, borderColor: border }}>
          {EMOJI_PALETTE.map(ch => (
            <TouchableOpacity
              key={ch}
              onPress={() => addEmoji(ch)}
              style={{ paddingHorizontal: 10, paddingVertical: 6, backgroundColor: theme.bg, borderRadius: 6, borderWidth: 1, borderColor: border }}
            >
              <Text style={{ fontSize: 22 }}>{ch}</Text>
            </TouchableOpacity>
          ))}
          {IMAGE_STICKERS.map(sticker => (
            <TouchableOpacity
              key={sticker.id}
              onPress={() => addEmoji({ imageSrc: sticker.source })}
              style={{ paddingHorizontal: 6, paddingVertical: 4, backgroundColor: theme.bg, borderRadius: 6, borderWidth: 1, borderColor: accent }}
              title={sticker.label}
            >
              <Image source={sticker.source} style={{ width: 28, height: 34, resizeMode: 'contain' }} />
            </TouchableOpacity>
          ))}
          {selectedId ? (
            <TouchableOpacity
              onPress={deleteSelected}
              style={{ paddingHorizontal: 10, paddingVertical: 6, backgroundColor: theme.danger || '#c62828', borderRadius: 6 }}
            >
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>Delete selected</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {/* Stats banner toggle — only available for player-search-loaded images */}
      {baseImageUrl && loadedPlayer ? (
        <View style={{ marginBottom: 12 }}>
          <TouchableOpacity
            onPress={() => setShowStatsBanner(v => !v)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              alignSelf: 'flex-start',
              paddingHorizontal: 12,
              paddingVertical: 8,
              backgroundColor: showStatsBanner ? accent : bgCard,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: showStatsBanner ? accent : border,
            }}
          >
            <Text style={{
              color: showStatsBanner ? '#fff' : text,
              fontSize: 12,
              fontWeight: '600',
            }}>
              {showStatsBanner ? '✓ ' : '+ '}Stats banner
            </Text>
          </TouchableOpacity>
          {showStatsBanner ? (
            <Text style={{ color: theme.textSecondary, fontSize: 11, marginTop: 4, fontStyle: 'italic' }}>
              {buildBannerText(loadedPlayer)}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Canvas — an <img> with absolutely positioned emoji divs over it.
          Using a raw DOM block via dangerouslySetInnerHTML would be too
          messy; instead we render using React Native's View which on web
          maps to <div>. For the <img> and emoji <div>s we use native
          JSX-style dangerouslySetInnerHTML... actually no — RN Web renders
          <View> as <div> so we can use inline style. */}
      {baseImageUrl ? (
        <div
          ref={containerRef}
          style={{
            position: 'relative',
            display: 'inline-block',
            maxWidth: '100%',
            border: `1px solid ${border}`,
            borderRadius: 6,
            overflow: 'hidden',
            backgroundColor: '#000',
            userSelect: 'none',
            touchAction: 'none',
          }}
        >
          <img
            ref={imgRef}
            src={baseImageUrl}
            alt="remix base"
            crossOrigin="anonymous"
            draggable={false}
            onLoad={(e) => {
              setBaseImageDims({ w: e.target.naturalWidth, h: e.target.naturalHeight });
            }}
            style={{
              display: 'block',
              maxWidth: '100%',
              maxHeight: '70vh',
              userSelect: 'none',
              pointerEvents: 'none',
            }}
          />
          {/* Stats banner — semi-transparent dark bar at bottom of image
              with player name + current-season stats. Fixed position, not
              draggable. Only shown when user toggles it on. */}
          {showStatsBanner && loadedPlayer ? (
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                background: 'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.75) 40%, rgba(0,0,0,0.9) 100%)',
                paddingTop: 18,
                paddingBottom: 10,
                paddingLeft: 12,
                paddingRight: 12,
                pointerEvents: 'none',
              }}
            >
              <div style={{
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                lineHeight: 1.2,
                textShadow: '0 1px 3px rgba(0,0,0,0.8)',
                fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
              }}>
                {buildBannerText(loadedPlayer)}
              </div>
            </div>
          ) : null}
          {/* Emoji overlays — coords/sizes are in IMAGE pixel space.
              We compute a display scale ratio from image natural pixels
              to current render pixels so positions stay pixel-exact AND
              match the canvas export. Each emoji is rendered in a fixed
              size × size box with centered inline glyph. */}
          {baseImageDims.w > 0 && (() => {
            // Actual displayed width of the <img>
            const img = imgRef.current;
            const displayedW = img ? img.getBoundingClientRect().width : baseImageDims.w;
            const scale = displayedW / baseImageDims.w;
            return emojis.map(e => {
              const selected = selectedId === e.id;
              const rotDeg = e.rotation || 0;
              const dispX = e.x * scale;
              const dispY = e.y * scale;
              const dispSize = e.size * scale;
              return (
                <div
                  key={e.id}
                  onPointerDown={(ev) => handlePointerDownOnEmoji(ev, e, 'move')}
                  style={{
                    position: 'absolute',
                    left: dispX + 'px',
                    top: dispY + 'px',
                    width: dispSize + 'px',
                    height: dispSize + 'px',
                    cursor: 'move',
                    userSelect: 'none',
                    touchAction: 'none',
                    transform: `rotate(${rotDeg}deg)`,
                    transformOrigin: '50% 50%',
                    // Flex-center the emoji so it sits inside its box
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    outline: selected ? `2px dashed ${accent}` : 'none',
                    outlineOffset: 2,
                  }}
                >
                  {e.imageSrc ? (
                    <img
                      src={typeof e.imageSrc === 'string' ? e.imageSrc : (e.imageSrc.uri || e.imageSrc.default || e.imageSrc)}
                      alt="sticker"
                      style={{
                        width: dispSize + 'px',
                        height: dispSize + 'px',
                        objectFit: 'contain',
                        pointerEvents: 'none',
                        userSelect: 'none',
                      }}
                      draggable={false}
                    />
                  ) : (
                    <span
                      style={{
                        fontSize: dispSize + 'px',
                        lineHeight: 1,
                        pointerEvents: 'none',
                        userSelect: 'none',
                        fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Android Emoji",sans-serif',
                      }}
                    >
                      {e.char}
                    </span>
                  )}
                  {selected ? (
                    <>
                      <div
                        onPointerDown={(ev) => handlePointerDownOnEmoji(ev, e, 'resize')}
                        style={{
                          position: 'absolute',
                          right: -9, bottom: -9,
                          width: 18, height: 18,
                          borderRadius: 9,
                          backgroundColor: accent,
                          cursor: 'nwse-resize',
                          border: '2px solid #fff',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                          touchAction: 'none',
                        }}
                        title="Drag to resize"
                      />
                      <div
                        onPointerDown={(ev) => handlePointerDownOnEmoji(ev, e, 'rotate')}
                        style={{
                          position: 'absolute',
                          left: '50%', top: -28,
                          marginLeft: -9,
                          width: 18, height: 18,
                          borderRadius: 9,
                          backgroundColor: '#4caf50',
                          cursor: 'grab',
                          border: '2px solid #fff',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                          touchAction: 'none',
                        }}
                        title="Drag to rotate"
                      />
                      <div
                        style={{
                          position: 'absolute',
                          left: '50%', top: -12,
                          width: 2, height: 14,
                          marginLeft: -1,
                          backgroundColor: '#4caf50',
                          pointerEvents: 'none',
                        }}
                      />
                    </>
                  ) : null}
                </div>
              );
            });
          })()}
        </div>
      ) : (
        <View style={{ padding: 30, backgroundColor: bgCard, borderRadius: 8, borderWidth: 1, borderColor: border, alignItems: 'center' }}>
          <Text style={{ color: theme.textSecondary, fontSize: 13 }}>
            Pick a player or upload an image to start remixing.
          </Text>
        </View>
      )}

      {/* Export */}
      {baseImageUrl ? (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <TouchableOpacity
            onPress={() => exportPNG('download')}
            style={{ backgroundColor: accent, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 }}
          >
            <Text style={{ color: '#fff', fontWeight: '600', fontSize: 13 }}>⬇ Download PNG</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => exportPNG('clipboard')}
            style={{ backgroundColor: accent, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 }}
          >
            <Text style={{ color: '#fff', fontWeight: '600', fontSize: 13 }}>📋 Copy to clipboard</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

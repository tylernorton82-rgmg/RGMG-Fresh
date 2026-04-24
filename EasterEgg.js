// EasterEgg.js - peteyBOI hover-too-long easter egg
// Drop this file in your project root alongside App.js
// Drop your peteyBOI jpeg in the `public/` folder as `peteyboi.jpg`

import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Image } from 'react-native';

const HOVER_DURATION_MS = 30000;   // 30 seconds of stillness
const COOLDOWN_MS = 600000;         // 10 minutes before it can fire again
const IDLE_CHECK_INTERVAL = 1000;   // check every 1s

// Base64-inlined peteyBOI image — bypasses static file serving entirely.
// Original file is a tiny 2.3KB JPEG, so embedding is cheap and bulletproof.
const PETEYBOI_IMAGE_B64 = "data:image/jpeg;base64,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";

const QUOTES = [
  "WAZOOOOO we are so back.",
  "Certified peteyBOI moment.",
  "Big move... massive wazoo.",
  "Trade accepted. Wazoo secured.",
  "Wazooooo brother that's elite.",
  "Roster upgraded... wazoo.",
  "PeteyBOI masterclass. Wazoo.",
  "This one got me wazoo.",
  "GM response time: slower than unc.",
  "WHO'S THE BEST??? IT'S PETEY YEAH!!!!",
  "You scroll slower than unc.",
];

// Pick a random quote, avoiding the last-shown one
function pickQuote(lastQuote) {
  let q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
  // Try once to avoid dupe
  if (q === lastQuote && QUOTES.length > 1) {
    q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
  }
  return q;
}

export default function EasterEgg({ theme }) {
  const [showPopup, setShowPopup] = useState(false);
  const [canDismiss, setCanDismiss] = useState(false);
  const [currentQuote, setCurrentQuote] = useState('');
  // Null until the user has interacted at least once. Prevents the egg from
  // firing during slow initial page loads (when user is waiting, not idle).
  const lastMoveRef = useRef(null);
  const lastFiredRef = useRef(0);
  const lastQuoteRef = useRef('');

  // Enable dismissal 1.5s after popup shows
  useEffect(() => {
    if (!showPopup) { setCanDismiss(false); return; }
    const t = setTimeout(() => setCanDismiss(true), 1500);
    return () => clearTimeout(t);
  }, [showPopup]);

  const tryDismiss = () => {
    if (canDismiss) setShowPopup(false);
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return; // web only

    console.log('[EasterEgg] Mounted. Platform:', Platform.OS);
    console.log('[EasterEgg] Idle timer started. Stop moving for 30 seconds to trigger.');

    // Debug: if URL has ?wazoo, fire immediately on mount
    if (typeof window !== 'undefined' && window.location.search.includes('wazoo')) {
      console.log('[EasterEgg] Debug mode — firing immediately');
      const q = pickQuote('');
      setCurrentQuote(q);
      setShowPopup(true);
      return;
    }

    const resetTimer = () => { lastMoveRef.current = Date.now(); };

    // Mouse / keyboard / touch activity all count as "moving"
    window.addEventListener('mousemove', resetTimer);
    window.addEventListener('keydown', resetTimer);
    window.addEventListener('touchstart', resetTimer);
    window.addEventListener('touchmove', resetTimer);
    window.addEventListener('scroll', resetTimer, true);

    // Pause checking if tab is not focused
    const onVisibilityChange = () => {
      if (document.hidden) resetTimer();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Interval check: has the user been still long enough?
    const interval = setInterval(() => {
      if (showPopup) return;
      if (document.hidden) return;
      // Skip until the user has interacted at least once — page load is not
      // "idle time". Without this, slow first-render (tier baselines sweep,
      // IndexedDB cache load) can burn through the 20s window before the
      // user even sees the page.
      if (lastMoveRef.current == null) return;
      const now = Date.now();
      const idle = now - lastMoveRef.current;
      const sinceLastFired = now - lastFiredRef.current;
      if (idle >= HOVER_DURATION_MS && sinceLastFired >= COOLDOWN_MS) {
        const q = pickQuote(lastQuoteRef.current);
        lastQuoteRef.current = q;
        setCurrentQuote(q);
        setShowPopup(true);
        lastFiredRef.current = now;
      }
    }, IDLE_CHECK_INTERVAL);

    return () => {
      window.removeEventListener('mousemove', resetTimer);
      window.removeEventListener('keydown', resetTimer);
      window.removeEventListener('touchstart', resetTimer);
      window.removeEventListener('touchmove', resetTimer);
      window.removeEventListener('scroll', resetTimer, true);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearInterval(interval);
    };
  }, [showPopup]);

  // Dismiss on ESC
  useEffect(() => {
    if (!showPopup || Platform.OS !== 'web') return;
    const onKey = (e) => { if (e.key === 'Escape') tryDismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showPopup, canDismiss]);

  if (!showPopup) return null;

  // Modal render (web only)
  if (Platform.OS === 'web') {
    return (
      <div
        onClick={tryDismiss}
        style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.75)',
          zIndex: 99999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          animation: 'fadeIn 0.3s ease-out',
          cursor: 'pointer',
        }}
      >
        <style>
          {`
            @keyframes fadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            @keyframes popIn {
              0% { transform: scale(0.7) rotate(-2deg); opacity: 0; }
              60% { transform: scale(1.05) rotate(1deg); }
              100% { transform: scale(1) rotate(0deg); opacity: 1; }
            }
            @keyframes wazoo-shake {
              0%, 100% { transform: translateX(0); }
              20% { transform: translateX(-4px); }
              40% { transform: translateX(4px); }
              60% { transform: translateX(-2px); }
              80% { transform: translateX(2px); }
            }
          `}
        </style>
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            backgroundColor: theme?.bgCard || '#1e1e2e',
            borderRadius: 16,
            padding: 24,
            maxWidth: 420,
            width: '90%',
            textAlign: 'center',
            border: `3px solid ${theme?.accent || '#4ade80'}`,
            boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 0 40px rgba(74,222,128,0.3)',
            animation: 'popIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
            cursor: 'default',
          }}
        >
          <div style={{ fontSize: 12, color: theme?.textMuted || '#888', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 12 }}>
            👑 A message from your King
          </div>
          <img
            src={PETEYBOI_IMAGE_B64}
            alt="peteyBOI"
            style={{
              width: 200,
              height: 200,
              borderRadius: '50%',
              objectFit: 'cover',
              border: `4px solid ${theme?.accent || '#4ade80'}`,
              marginBottom: 16,
              animation: 'wazoo-shake 0.8s ease-in-out',
            }}
            onError={(e) => {
              // If jpeg doesn't load yet, hide image gracefully
              e.target.style.display = 'none';
            }}
          />
          <div
            style={{
              color: theme?.text || '#fff',
              fontSize: 20,
              fontWeight: 'bold',
              marginBottom: 8,
              lineHeight: 1.3,
            }}
          >
            "{currentQuote}"
          </div>
          <div style={{ color: theme?.textMuted || '#888', fontSize: 13, fontStyle: 'italic', marginBottom: 20 }}>
            — peteyBOI
          </div>
          <button
            onClick={tryDismiss}
            style={{
              padding: '10px 24px',
              backgroundColor: canDismiss ? (theme?.accent || '#4ade80') : '#666',
              color: '#000',
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 'bold',
              cursor: canDismiss ? 'pointer' : 'wait',
              textTransform: 'uppercase',
              letterSpacing: 1,
              opacity: canDismiss ? 1 : 0.6,
            }}
          >
            {canDismiss ? 'Wazoo' : '...'}
          </button>
          <div style={{ color: theme?.textMuted || '#666', fontSize: 10, marginTop: 12 }}>
            (click anywhere or press ESC to dismiss)
          </div>
        </div>
      </div>
    );
  }

  return null;
}

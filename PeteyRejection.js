// PeteyRejection.js — full-screen overlay shown when a trade fails
// validation. Displays the petey.gif meme with optional "AH AH AH!"
// audio, auto-dismisses after 3.5s or on tap/click.
//
// Usage from TradeCalc (or anywhere):
//   const [showReject, setShowReject] = useState(false);
//   <PeteyRejection visible={showReject} onClose={() => setShowReject(false)} />

import React, { useEffect, useRef } from 'react';
import { View, Text, Modal, TouchableOpacity, Platform, Image } from 'react-native';

// Bundled assets. These paths assume the GIF lives at assets/petey.gif.
// Drop the file in your repo's assets/ folder and the bundler will pick it up.
// eslint-disable-next-line global-require
const PETEY_GIF = require('./assets/petey.gif');

// Tiny beep/AH sound is optional — if you have petey.mp3 in assets it will
// be played. If not, the require() fails silently and the overlay still shows.
let PETEY_SOUND = null;
try {
  // eslint-disable-next-line global-require
  PETEY_SOUND = require('./assets/petey.mp3');
} catch (e) {
  PETEY_SOUND = null;
}

export default function PeteyRejection({ visible, onClose, reason }) {
  const audioRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!visible) return;
    // Play sound on mount if available (web only — native would need expo-av)
    if (Platform.OS === 'web' && PETEY_SOUND) {
      try {
        const audio = new Audio(typeof PETEY_SOUND === 'string' ? PETEY_SOUND : PETEY_SOUND.uri || PETEY_SOUND);
        audio.volume = 0.8;
        audio.play().catch(() => { /* autoplay blocked — silent fallback */ });
        audioRef.current = audio;
      } catch (e) { /* no-op */ }
    }
    // Auto-dismiss after 3.5 seconds (GIF runs a couple loops)
    timerRef.current = setTimeout(() => {
      if (onClose) onClose();
    }, 3500);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (audioRef.current) {
        try { audioRef.current.pause(); } catch (e) {}
        audioRef.current = null;
      }
    };
  }, [visible, onClose]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        activeOpacity={1}
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.88)',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
        }}
      >
        <Text style={{
          color: '#ff5252',
          fontSize: 34,
          fontWeight: '900',
          textAlign: 'center',
          textShadow: '0 2px 6px rgba(0,0,0,0.9)',
          marginBottom: 18,
          letterSpacing: 1,
        }}>
          TRADE REJECTED
        </Text>
        <Image
          source={PETEY_GIF}
          style={{
            width: 340,
            height: 260,
            resizeMode: 'contain',
          }}
        />
        {reason ? (
          <Text style={{
            color: '#fff',
            fontSize: 14,
            fontWeight: '600',
            textAlign: 'center',
            marginTop: 16,
            maxWidth: 360,
            textShadow: '0 1px 3px rgba(0,0,0,0.9)',
          }}>
            {reason}
          </Text>
        ) : null}
        <Text style={{
          color: '#aaa',
          fontSize: 11,
          marginTop: 18,
          fontStyle: 'italic',
        }}>
          tap anywhere to dismiss
        </Text>
      </TouchableOpacity>
    </Modal>
  );
}

/**
 * voice.js — shared voice input utility
 * Uses Web Speech API (no server, no API key)
 * Supports EN / RU with toggle stored in localStorage
 */

(function() {
  'use strict';

  // ── LANG STATE ──
  const LANGS = {
    'en': { code: 'en-US', label: 'EN' },
    'ru': { code: 'ru-RU', label: 'RU' }
  };

  function getCurrentLang() {
    return localStorage.getItem('voiceLang') || 'en';
  }

  function setCurrentLang(lang) {
    localStorage.setItem('voiceLang', lang);
    // Update all lang toggle buttons on page
    document.querySelectorAll('.voice-lang-toggle').forEach(btn => {
      btn.textContent = LANGS[lang].label;
      btn.dataset.lang = lang;
    });
    // Update all active mic buttons' recognition language
    document.querySelectorAll('.voice-mic-btn').forEach(btn => {
      btn.dataset.lang = lang;
    });
  }

  // ── SPEECH RECOGNITION CHECK ──
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const supported = !!SpeechRecognition;

  // ── ACTIVE RECOGNITION INSTANCE (one at a time) ──
  let activeRecognition = null;
  let activeBtn = null;

  function stopActive() {
    if (activeRecognition) {
      try { activeRecognition.stop(); } catch(e) {}
      activeRecognition = null;
    }
    if (activeBtn) {
      setMicIdle(activeBtn);
      activeBtn = null;
    }
  }

  function setMicRecording(btn) {
    btn.classList.add('voice-recording');
    btn.innerHTML = `<span class="voice-pulse"></span>`;
    btn.title = 'Stop recording';
  }

  function setMicIdle(btn) {
    btn.classList.remove('voice-recording');
    btn.innerHTML = `🎤`;
    btn.title = 'Voice input (' + LANGS[getCurrentLang()].label + ')';
  }

  // ── CORE: attach mic button to any input or textarea ──
  window.attachVoiceBtn = function(inputEl, options) {
    if (!inputEl) return;
    if (!supported) {
      // Show disabled icon — Firefox etc
      const btn = document.createElement('button');
      btn.className = 'voice-mic-btn voice-unsupported';
      btn.innerHTML = '🎤';
      btn.title = 'Voice input not supported in this browser (use Chrome or Safari)';
      btn.type = 'button';
      btn.disabled = true;
      insertAfter(btn, inputEl);
      return;
    }

    const btn = document.createElement('button');
    btn.className = 'voice-mic-btn';
    btn.innerHTML = '🎤';
    btn.type = 'button';
    btn.title = 'Voice input';
    btn.dataset.lang = getCurrentLang();

    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();

      // If this button is already recording — stop
      if (btn === activeBtn) {
        stopActive();
        return;
      }

      // Stop any other recording
      stopActive();

      const lang = LANGS[getCurrentLang()].code;
      const recognition = new SpeechRecognition();
      recognition.lang = lang;
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        activeRecognition = recognition;
        activeBtn = btn;
        setMicRecording(btn);
      };

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        // Append to existing text with a space
        const current = inputEl.value;
        inputEl.value = current ? current + ' ' + transcript : transcript;
        // Trigger input event so any listeners (like chat auto-resize) fire
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        // Focus the input
        inputEl.focus();
      };

      recognition.onerror = (event) => {
        if (event.error === 'no-speech') {
          // Silent — user just didn't say anything
        } else if (event.error === 'not-allowed') {
          showVoiceToast('Microphone access denied. Please allow microphone in browser settings.');
        } else {
          showVoiceToast('Voice error: ' + event.error);
        }
        stopActive();
      };

      recognition.onend = () => {
        // Only reset if this is still the active one
        if (activeBtn === btn) stopActive();
      };

      try {
        recognition.start();
      } catch(e) {
        showVoiceToast('Could not start voice input: ' + e.message);
      }
    });

    insertAfter(btn, inputEl);
    return btn;
  };

  // ── LANG TOGGLE BUTTON ──
  // Call this to create a standalone EN/RU toggle button
  window.createLangToggle = function(containerEl) {
    if (!supported) return;
    const btn = document.createElement('button');
    btn.className = 'voice-lang-toggle';
    btn.type = 'button';
    const lang = getCurrentLang();
    btn.textContent = LANGS[lang].label;
    btn.dataset.lang = lang;
    btn.title = 'Switch voice language';

    btn.addEventListener('click', function() {
      const newLang = getCurrentLang() === 'en' ? 'ru' : 'en';
      setCurrentLang(newLang);
      btn.textContent = LANGS[newLang].label;
    });

    if (containerEl) containerEl.appendChild(btn);
    return btn;
  };

  // ── CONVENIENCE: inject into chat header ──
  // Call after DOM is ready to add lang toggle to chat header
  window.injectVoiceLangToggle = function(headerSelector) {
    const header = document.querySelector(headerSelector);
    if (!header || !supported) return;
    const wrap = document.createElement('span');
    wrap.style.marginLeft = 'auto';
    createLangToggle(wrap);
    header.appendChild(wrap);
  };

  // ── TOAST ──
  function showVoiceToast(msg) {
    // Reuse existing toast if present, otherwise create one
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'voice-toast';
      toast.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%) translateY(80px);background:#3d5a7a;color:#fff;padding:12px 22px;border-radius:12px;font-size:14px;font-weight:600;transition:transform .3s;z-index:9999;white-space:nowrap;font-family:DM Sans,sans-serif;';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    toast.style.transform = 'translateX(-50%) translateY(0)';
    setTimeout(() => {
      toast.classList.remove('show');
      toast.style.transform = 'translateX(-50%) translateY(80px)';
    }, 3500);
  }

  // ── HELPER ──
  function insertAfter(newEl, referenceEl) {
    // Insert button as sibling — wraps input in a flex container if needed
    const parent = referenceEl.parentNode;
    if (!parent) return;

    // If parent is already a voice-wrap, just append
    if (parent.classList && parent.classList.contains('voice-wrap')) {
      parent.appendChild(newEl);
      return;
    }

    // Otherwise wrap the input
    const wrap = document.createElement('div');
    wrap.className = 'voice-wrap';
    // Copy display style from input
    const inputStyle = window.getComputedStyle(referenceEl);
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'flex-end';
    wrap.style.gap = '6px';
    wrap.style.width = '100%';

    parent.insertBefore(wrap, referenceEl);
    wrap.appendChild(referenceEl);
    wrap.appendChild(newEl);
  }

  // ── GLOBAL CSS ──
  const style = document.createElement('style');
  style.textContent = `
    .voice-mic-btn {
      flex-shrink: 0;
      width: 36px;
      height: 36px;
      border-radius: 10px;
      border: 2px solid #dce5ef;
      background: #ffffff;
      font-size: 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: border-color .2s, background .2s;
      padding: 0;
      align-self: flex-end;
      margin-bottom: 2px;
      position: relative;
    }
    .voice-mic-btn:hover {
      border-color: #8b9fd4;
      background: #dde3f5;
    }
    .voice-mic-btn.voice-recording {
      border-color: #c05a5a;
      background: #fde8e8;
      animation: voice-glow .8s ease-in-out infinite alternate;
    }
    .voice-mic-btn.voice-unsupported {
      opacity: 0.35;
      cursor: default;
    }
    @keyframes voice-glow {
      from { box-shadow: 0 0 0 0 rgba(192,90,90,.4); }
      to   { box-shadow: 0 0 0 6px rgba(192,90,90,0); }
    }
    .voice-pulse {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #c05a5a;
      display: block;
      animation: voice-pulse-dot .6s ease-in-out infinite alternate;
    }
    @keyframes voice-pulse-dot {
      from { transform: scale(1); opacity: 1; }
      to   { transform: scale(1.4); opacity: .7; }
    }
    .voice-lang-toggle {
      padding: 4px 10px;
      border-radius: 8px;
      border: 2px solid rgba(255,255,255,.25);
      background: rgba(255,255,255,.12);
      color: #c8dcf0;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      font-family: 'DM Sans', sans-serif;
      letter-spacing: .05em;
      transition: background .2s;
      flex-shrink: 0;
    }
    .voice-lang-toggle:hover {
      background: rgba(255,255,255,.22);
    }
    /* Make voice-wrap take full width when wrapping a full-width textarea */
    .voice-wrap > textarea,
    .voice-wrap > input {
      flex: 1;
      min-width: 0;
    }
  `;
  document.head.appendChild(style);

})();

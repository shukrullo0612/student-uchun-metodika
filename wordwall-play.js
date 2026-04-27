const WORDWALL_API_BASE =
  window.API_BASE_URL ||
  localStorage.getItem('eduskill.apiBase') ||
  'http://localhost:3001/api';

const LIVE_CODE_REGEX = /^\d{5}$/;

const state = {
  setData: null,
  answersByItem: new Map(),
  currentIndex: 0,
  currentSlots: [],
  shuffledLetters: [],
  currentWordLengths: [],
  currentWordGroups: [],
  timerStartedAt: null,
  timerIntervalId: null,
  liveStatus: 'waiting',
  liveParticipantsCount: 0,
  liveParticipants: [],
  liveParticipantsTimerId: null,
  liveSessionId: null,
};

const pageParams = new URLSearchParams(window.location.search);
const isAutoplayMode = pageParams.get('autoplay') === '1';

if (isAutoplayMode) {
  document.body.classList.add('wordwall-autoplay');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getStoredAccessToken() {
  return sessionStorage.getItem('eduskill.accessToken') || localStorage.getItem('eduskill.accessToken');
}

async function request(path, { method = 'GET', body, auth = false, retry = true } = {}) {
  if (window.eduAuth && typeof window.eduAuth.apiRequest === 'function') {
    return window.eduAuth.apiRequest(path, { method, body, auth, retry });
  }

  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getStoredAccessToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${WORDWALL_API_BASE}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch (error) {
    payload = {};
  }

  if (!response.ok) {
    const err = new Error(payload.message || 'Request failed');
    err.status = response.status;
    err.code = payload.error;
    throw err;
  }

  return payload;
}

function setStatus(message, type = 'info') {
  const box = document.getElementById('wordwall-status');
  box.className = `status-box status-${type}`;
  box.textContent = message;
}

function getSignedInUserName() {
  if (!window.eduAuth || typeof window.eduAuth.getCurrentUser !== 'function') {
    return '';
  }

  const currentUser = window.eduAuth.getCurrentUser();
  return String(
    currentUser?.name
      || currentUser?.full_name
      || currentUser?.fullName
      || currentUser?.email
      || ''
  )
    .trim()
    .replace(/\s+/g, ' ');
}

function resolvePlayerName() {
  const playerInput = document.getElementById('player-name-input');
  const fromInput = String(playerInput?.value || '').trim().replace(/\s+/g, ' ');
  const fromQuery = String(pageParams.get('player') || '').trim().replace(/\s+/g, ' ');
  const fromSession = getSignedInUserName();

  const name = fromInput || fromQuery || fromSession;
  if (playerInput && name && !String(playerInput.value || '').trim()) {
    playerInput.value = name;
  }

  return name;
}

function hideAnagramCompletionModal() {
  const modal = document.getElementById('anagram-completion-modal');
  if (!modal) {
    return;
  }

  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('wordwall-modal-open');
}

function showAnagramCompletionModal({ playerName, result }) {
  const modal = document.getElementById('anagram-completion-modal');
  if (!modal) {
    return;
  }

  const titleEl = document.getElementById('anagram-completion-title');
  const subtitleEl = document.getElementById('anagram-completion-subtitle');
  const scoreEl = document.getElementById('anagram-completion-score');
  const accuracyEl = document.getElementById('anagram-completion-accuracy');
  const timeEl = document.getElementById('anagram-completion-time');
  const noteEl = document.getElementById('anagram-completion-note');
  const timerEl = document.getElementById('anagram-timer');

  const safeName = String(playerName || 'Oquvchi').trim();
  const score = Number(result?.score || 0);
  const correct = Number(result?.correct || 0);
  const totalItems = Number(result?.totalItems || 0);
  const duration = String(timerEl?.textContent || '00:00').trim() || '00:00';
  const activityTitle = String(state.setData?.title || 'Anagramma').trim();

  if (titleEl) {
    titleEl.textContent = `Tabriklaymiz, ${safeName}!`;
  }
  if (subtitleEl) {
    subtitleEl.textContent = `${activityTitle} anagramma mashqini muvaffaqiyatli yakunladingiz.`;
  }
  if (scoreEl) {
    scoreEl.textContent = `Natija: ${score}%`;
  }
  if (accuracyEl) {
    accuracyEl.textContent = `To'g'ri javob: ${correct}/${totalItems}`;
  }
  if (timeEl) {
    timeEl.textContent = `Sarflangan vaqt: ${duration}`;
  }
  if (noteEl) {
    if (score >= 90) {
      noteEl.textContent = 'Ajoyib! Harflarni joylashtirishda juda yuqori aniqlik ko\'rsatdingiz.';
    } else if (score >= 70) {
      noteEl.textContent = 'Yaxshi natija! Keyingi urinishda yanada yuqori ball olasiz.';
    } else {
      noteEl.textContent = 'Yakunladingiz! Qayta urinib ko\'rsangiz natijangiz yanada yaxshilanadi.';
    }
  }

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('wordwall-modal-open');
}

function normalizeAnagramComparable(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function getCurrentAnagramItem() {
  const items = getActiveAnagramItems();
  return items[state.currentIndex] || null;
}

function getExpectedAnagramAnswer(item) {
  const direct = String(item?.expected_answer || '').trim();
  if (direct) {
    return direct;
  }

  return '';
}

function renderAnagramValidation() {
  const indicator = document.getElementById('anagram-validation');
  const answerEl = document.getElementById('anagram-answer');
  if (!indicator || !answerEl) {
    return;
  }

  answerEl.classList.remove('anagram-correct', 'anagram-wrong');

  const item = getCurrentAnagramItem();
  const expected = normalizeAnagramComparable(getExpectedAnagramAnswer(item));
  const actual = normalizeAnagramComparable(state.currentSlots.join(''));
  const isComplete =
    state.currentSlots.length > 0
      && state.currentSlots.every((slot) => String(slot || '').trim().length > 0);

  if (!item || !expected || !isComplete) {
    indicator.className = 'anagram-validation';
    indicator.textContent = 'Harflarni to\'liq joylashtiring.';
    return;
  }

  const isCorrect = actual === expected;
  indicator.className = `anagram-validation ${isCorrect ? 'is-correct' : 'is-wrong'}`;
  indicator.textContent = isCorrect ? "To'g'ri javob ✓" : "Noto'g'ri joylashuv X";
  answerEl.classList.add(isCorrect ? 'anagram-correct' : 'anagram-wrong');
}

function getNormalizedLivePin() {
  const pinInput = document.getElementById('wordwall-pin-input');
  return String(pinInput?.value || pageParams.get('pin') || state.setData?.pin || '')
    .replace(/\D/g, '')
    .slice(0, 5);
}

function formatParticipantJoinedAt(joinedAt) {
  if (!joinedAt) {
    return '--:--';
  }

  const date = new Date(joinedAt);
  if (Number.isNaN(date.getTime())) {
    return '--:--';
  }

  return date.toLocaleTimeString('uz-UZ', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderLiveParticipantsList(participants = []) {
  const listEl = document.getElementById('live-participants-list');
  if (!listEl) {
    return;
  }

  const rows = Array.isArray(participants) ? participants : [];
  if (rows.length === 0) {
    listEl.innerHTML = '<div class="wordwall-live-empty">Hali ishtirokchi yo\'q</div>';
    return;
  }

  listEl.innerHTML = rows
    .map((item, index) => {
      const name = escapeHtml(item.player_name || `Ishtirokchi ${index + 1}`);
      const joinedAt = formatParticipantJoinedAt(item.joined_at);
      return `
        <div class="wordwall-live-participant-item">
          <strong>${index + 1}. ${name}</strong>
          <span>${joinedAt}</span>
        </div>
      `;
    })
    .join('');
}

async function loadLiveParticipants(showError = false) {
  const code = getNormalizedLivePin();

  if (!LIVE_CODE_REGEX.test(code)) {
    state.liveSessionId = null;
    state.liveParticipants = [];
    state.liveParticipantsCount = 0;
    renderLiveParticipantsList([]);
    renderLivePanel();
    return;
  }

  try {
    const payload = await request(`/wordwall/live/${encodeURIComponent(code)}/participants`);
    const data = payload.data || {};
    const participants = Array.isArray(data.participants) ? data.participants : [];

    state.liveSessionId = data.sessionId || null;
    state.liveParticipants = participants;
    state.liveParticipantsCount = Number(data.participantsCount || participants.length || 0);
    if (data.status) {
      state.liveStatus = String(data.status);
    }

    renderLiveParticipantsList(participants);
    renderLivePanel();
  } catch (error) {
    state.liveParticipants = [];
    state.liveParticipantsCount = 0;
    renderLiveParticipantsList([]);
    renderLivePanel();

    if (showError) {
      setStatus(error.message || 'Live ishtirokchilarni yuklab bolmadi.', 'error');
    }
  }
}

function stopLiveParticipantsPolling() {
  if (state.liveParticipantsTimerId) {
    clearInterval(state.liveParticipantsTimerId);
    state.liveParticipantsTimerId = null;
  }
}

function startLiveParticipantsPolling() {
  stopLiveParticipantsPolling();
  loadLiveParticipants(false);
  state.liveParticipantsTimerId = setInterval(() => {
    loadLiveParticipants(false);
  }, 2000);
}

function renderLivePanel() {
  const panel = document.getElementById('wordwall-live-panel');
  if (!panel) {
    return;
  }

  const pin = getNormalizedLivePin();
  const pinEl = document.getElementById('live-pin-display');
  const statusEl = document.getElementById('live-status-chip');
  const playersEl = document.getElementById('live-players-chip');
  const progressEl = document.getElementById('live-progress-chip');
  const timeEl = document.getElementById('live-time-chip');

  if (pinEl) {
    pinEl.textContent = pin || '-----';
  }

  if (statusEl) {
    statusEl.textContent = state.liveStatus;
  }

  if (playersEl) {
    const count = Number.isFinite(Number(state.liveParticipantsCount))
      ? Number(state.liveParticipantsCount)
      : 0;
    playersEl.textContent = `${count} o'quvchi`;
  }

  if (progressEl) {
    const total = getActiveAnagramItems().length;
    const current = total > 0 ? Math.min(state.currentIndex + 1, total) : 0;
    progressEl.textContent = `${current} / ${total}`;
  }

  if (timeEl) {
    const timerText = String(document.getElementById('anagram-timer')?.textContent || '00:00').trim();
    timeEl.textContent = timerText || '00:00';
  }
}

async function copyTextToClipboard(value) {
  const text = String(value || '').trim();
  if (!text) {
    return false;
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      // Fallback below handles non-secure contexts (file://) and permission blocks.
    }
  }

  const tempArea = document.createElement('textarea');
  tempArea.value = text;
  tempArea.setAttribute('readonly', 'readonly');
  tempArea.style.position = 'absolute';
  tempArea.style.left = '-9999px';
  document.body.appendChild(tempArea);
  tempArea.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch (error) {
    copied = false;
  }

  document.body.removeChild(tempArea);
  return copied;
}

async function copyLivePinCode() {
  const pin = getNormalizedLivePin();
  if (!/^\d{5}$/.test(pin)) {
    setStatus('Nusxalash uchun avval 5 xonali kod kiriting.', 'error');
    return;
  }

  const copied = await copyTextToClipboard(pin);
  if (copied) {
    setStatus('Live kod nusxalandi.', 'success');
    return;
  }

  setStatus('Kodni nusxalab bo\'lmadi.', 'error');
}

async function copyLiveAssignLink() {
  const pin = getNormalizedLivePin();
  if (!/^\d{5}$/.test(pin)) {
    setStatus('Link yaratish uchun avval 5 xonali kod kiriting.', 'error');
    return;
  }

  const shareUrl = new URL(window.location.href);
  shareUrl.searchParams.set('pin', pin);
  shareUrl.searchParams.set('autoplay', '1');
  shareUrl.searchParams.delete('setId');

  const copied = await copyTextToClipboard(shareUrl.toString());
  if (copied) {
    setStatus('Assign link nusxalandi.', 'success');
    return;
  }

  setStatus('Assign linkni nusxalab bo\'lmadi.', 'error');
}

async function hostLiveSession() {
  try {
    if (!state.setData) {
      await loadSet();
    }

    if (!state.setData) {
      return;
    }

    setStatus('Live sessiya tayyorlanmoqda...', 'info');
    const payload = await request(`/wordwall/sets/${encodeURIComponent(state.setData.id)}/live`, {
      method: 'POST',
      auth: true,
    });

    const data = payload.data || {};
    state.liveSessionId = data.id || state.liveSessionId;
    state.liveStatus = String(data.status || 'waiting');

    startLiveParticipantsPolling();
    renderLivePanel();
    setStatus('Live tayyor. Start tugmasini bosing.', 'success');
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      setStatus('Live host uchun admin akkauntda tizimga kirgan bo\'lishingiz kerak.', 'error');
      return;
    }

    setStatus(error.message || 'Live sessiyani tayyorlab bo\'lmadi.', 'error');
  }
}

async function startLiveSession() {
  try {
    if (!state.setData) {
      await loadSet();
    }

    if (!state.setData) {
      return;
    }

    setStatus('Live sessiya start qilinmoqda...', 'info');

    let sessionId = state.liveSessionId;
    if (!sessionId) {
      const ensurePayload = await request(`/wordwall/sets/${encodeURIComponent(state.setData.id)}/live`, {
        method: 'POST',
        auth: true,
      });
      sessionId = ensurePayload.data?.id || null;
    }

    if (!sessionId) {
      setStatus('Live sessiya topilmadi. Avval Host Live ni bosing.', 'error');
      return;
    }

    const payload = await request(`/wordwall/live/sessions/${encodeURIComponent(sessionId)}/start`, {
      method: 'POST',
      auth: true,
    });

    state.liveSessionId = payload.data?.id || sessionId;
    state.liveStatus = String(payload.data?.status || 'live');
    startLiveParticipantsPolling();
    renderLivePanel();
    setStatus('Live sessiya boshlandi. O\'quvchilar kirishi mumkin.', 'success');
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      setStatus('Start uchun admin akkauntda tizimga kirgan bo\'lishingiz kerak.', 'error');
      return;
    }

    setStatus(error.message || 'Live sessiyani start qilib bo\'lmadi.', 'error');
  }
}

function parseAnagramPrompt(prompt) {
  const raw = String(prompt || '').trim();
  const match = raw.match(/^anagram\s*:\s*(.+)$/i);
  if (match) {
    return match[1].trim();
  }
  return raw;
}

function shuffleLetters(sourceWord) {
  const base = String(sourceWord || '').replace(/\s+/g, '');
  if (base.length <= 1) {
    return base.split('');
  }

  let chars = base.split('');
  let shuffled = chars.join('');

  for (let attempt = 0; attempt < 10 && shuffled.toLowerCase() === base.toLowerCase(); attempt += 1) {
    chars = base.split('');
    for (let i = chars.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    shuffled = chars.join('');
  }

  if (shuffled.toLowerCase() === base.toLowerCase()) {
    shuffled = base.split('').reverse().join('');
  }

  return shuffled.split('');
}

function getWordLengths(phrase) {
  return String(phrase || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.length)
    .filter((len) => len > 0);
}

function normalizeWordLengths(lengths) {
  if (!Array.isArray(lengths)) {
    return [];
  }

  return lengths
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function segmentByWordLengths(source, lengths) {
  const compact = String(source || '').replace(/\s+/g, '');
  let cursor = 0;

  return lengths.map((length) => {
    const chunk = compact.slice(cursor, cursor + length);
    cursor += length;
    return chunk;
  });
}

function getGroupIndexBySlotIndex(slotIndex) {
  const match = state.currentWordGroups.find((group) => {
    return slotIndex >= group.start && slotIndex < group.start + group.length;
  });

  return match ? match.index : null;
}

function getUsedLetterIndexesForGroup(group) {
  if (!group) {
    return new Set();
  }

  const used = new Set();
  for (let offset = 0; offset < group.length; offset += 1) {
    const slotLetter = String(state.currentSlots[group.start + offset] || '');
    if (!slotLetter) {
      continue;
    }

    const letterIndex = group.letters.findIndex((letter, idx) => {
      return !used.has(idx) && String(letter || '').toLowerCase() === slotLetter.toLowerCase();
    });

    if (letterIndex >= 0) {
      used.add(letterIndex);
    }
  }

  return used;
}

function getActiveAnagramItems() {
  if (!state.setData) {
    return [];
  }

  return (state.setData.items || []).filter((item) => !item.options);
}

function formatElapsedTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60)
    .toString()
    .padStart(2, '0');
  const remainder = Math.floor(safe % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function startAnagramTimer() {
  if (state.timerIntervalId) {
    clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;
  }

  state.liveStatus = 'live';
  state.timerStartedAt = Date.now();
  const timerEl = document.getElementById('anagram-timer');
  if (timerEl) {
    timerEl.textContent = '00:00';
  }
  renderLivePanel();

  state.timerIntervalId = setInterval(() => {
    const elapsedSeconds = Math.floor((Date.now() - state.timerStartedAt) / 1000);
    if (timerEl) {
      timerEl.textContent = formatElapsedTime(elapsedSeconds);
    }
    renderLivePanel();
  }, 1000);
}

function stopAnagramTimer() {
  if (state.timerIntervalId) {
    clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;
  }

  renderLivePanel();
}

function computeAnagramScore() {
  const items = getActiveAnagramItems();
  const total = items.length;
  if (total === 0) {
    return { total: 0, filled: 0 };
  }

  let filled = 0;
  items.forEach((item) => {
    const actual = String(state.answersByItem.get(item.id) || '').trim().toLowerCase();
    if (actual) {
      filled += 1;
    }
  });

  return { total, filled };
}

function persistCurrentAnagramAnswer() {
  const items = getActiveAnagramItems();
  const item = items[state.currentIndex];
  if (!item) {
    return;
  }

  const answer = state.currentSlots.join('');
  if (answer) {
    state.answersByItem.set(item.id, answer);
    return;
  }

  state.answersByItem.delete(item.id);
}

function renderAnagramScore() {
  const scoreEl = document.getElementById('anagram-score');
  if (!scoreEl) {
    return;
  }

  const { total, filled } = computeAnagramScore();
  scoreEl.textContent = `Javoblar: ${filled}/${total}`;
  renderAnagramValidation();
  renderLivePanel();
}

function renderAnagramCurrentItem() {
  const items = getActiveAnagramItems();
  const total = items.length;
  const item = items[state.currentIndex];

  const progressEl = document.getElementById('anagram-progress');
  const lettersEl = document.getElementById('anagram-letters');
  const answerEl = document.getElementById('anagram-answer');
  const hintEl = document.getElementById('anagram-hint');
  const nextButton = document.getElementById('anagram-next-btn');

  if (!item || !lettersEl || !answerEl || !hintEl) {
    if (progressEl) {
      progressEl.textContent = '0 / 0';
    }
    renderLivePanel();
    return;
  }

  if (progressEl) {
    progressEl.textContent = `${state.currentIndex + 1} / ${total}`;
  }

  const promptPhrase = parseAnagramPrompt(item.prompt);
  const anagramSeed = parseAnagramPrompt(item.anagram_seed || promptPhrase);
  const compactSeed = String(anagramSeed || '').replace(/\s+/g, '');
  const fallbackCompact = String(promptPhrase || '').replace(/\s+/g, '');
  const letterSource = compactSeed || fallbackCompact;

  const payloadWordLengths = normalizeWordLengths(item.word_lengths);
  const payloadWordTotal = payloadWordLengths.reduce((sum, len) => sum + len, 0);

  let resolvedWordLengths = payloadWordLengths;
  if (resolvedWordLengths.length === 0 || payloadWordTotal !== letterSource.length) {
    const seedWordLengths = getWordLengths(anagramSeed);
    const seedWordTotal = seedWordLengths.reduce((sum, len) => sum + len, 0);
    if (seedWordLengths.length > 0 && seedWordTotal === letterSource.length) {
      resolvedWordLengths = seedWordLengths;
    }
  }

  if (resolvedWordLengths.length === 0) {
    const fallbackLength = letterSource.length;
    resolvedWordLengths = fallbackLength > 0 ? [fallbackLength] : [];
  }

  const targetLength = resolvedWordLengths.reduce((sum, len) => sum + len, 0);
  const clueMode = String(state.setData?.clue_mode || 'without').toLowerCase();
  const useGroupedSlots = resolvedWordLengths.length > 1;

  state.currentWordLengths = resolvedWordLengths;
  if (state.currentWordLengths.length === 0 && targetLength > 0) {
    state.currentWordLengths = [targetLength];
  }

  const existingAnswer = String(state.answersByItem.get(item.id) || '');
  state.currentSlots = Array.from({ length: targetLength }, (_, idx) => existingAnswer[idx] || '');

  const letterSegments = segmentByWordLengths(letterSource, state.currentWordLengths);
  state.currentWordGroups = [];

  let cursor = 0;
  state.currentWordLengths.forEach((wordLength, groupIndex) => {
    const segment = String(letterSegments[groupIndex] || '').slice(0, wordLength);
    const source = segment || String(letterSource || '').slice(cursor, cursor + wordLength);
    const shuffled = shuffleLetters(source).slice(0, wordLength);
    const letters = Array.from({ length: wordLength }, (_, idx) => shuffled[idx] || source[idx] || '');

    state.currentWordGroups.push({
      index: groupIndex,
      start: cursor,
      length: wordLength,
      letters,
    });

    cursor += wordLength;
  });

  state.shuffledLetters = state.currentWordGroups.flatMap((group) => group.letters);

  if (useGroupedSlots) {
    lettersEl.classList.add('hidden');
    lettersEl.innerHTML = '';

    answerEl.classList.add('anagram-multi-word');
    answerEl.classList.add('with-clues');

    answerEl.innerHTML = state.currentWordGroups
      .map((group) => {
        const usedLetterIndexes = getUsedLetterIndexesForGroup(group);

        const lettersHtml = group.letters
          .map((letter, letterIndex) => {
            const disabled = usedLetterIndexes.has(letterIndex) ? ' disabled' : '';
            return `<button type="button" class="anagram-letter" data-group-index="${group.index}" data-letter-index="${letterIndex}"${disabled}>${escapeHtml(letter)}</button>`;
          })
          .join('');

        const slotsHtml = Array.from({ length: group.length }, (_, slotOffset) => {
          const globalIndex = group.start + slotOffset;
          const letter = state.currentSlots[globalIndex] || '';
          const classes = letter ? 'anagram-slot filled' : 'anagram-slot';
          return `<button type="button" class="${classes}" data-group-index="${group.index}" data-slot-index="${globalIndex}">${escapeHtml(letter)}</button>`;
        }).join('');

        return `
          <article class="anagram-word-card" data-group-index="${group.index}">
            <div class="anagram-word-letters">${lettersHtml}</div>
            <div class="anagram-word-slots">${slotsHtml}</div>
          </article>
        `;
      })
      .join('');
  } else {
    lettersEl.classList.remove('hidden');

    const group = state.currentWordGroups[0] || { index: 0, start: 0, length: targetLength, letters: [] };
    const usedLetterIndexes = getUsedLetterIndexesForGroup(group);
    lettersEl.innerHTML = group.letters
      .map((letter, index) => {
        const disabled = usedLetterIndexes.has(index) ? ' disabled' : '';
        return `<button type="button" class="anagram-letter" data-letter-index="${index}"${disabled}>${escapeHtml(letter)}</button>`;
      })
      .join('');

    answerEl.classList.remove('anagram-multi-word');
    answerEl.classList.remove('with-clues');
    answerEl.innerHTML = state.currentSlots
      .map((letter, index) => {
        const classes = letter ? 'anagram-slot filled' : 'anagram-slot';
        return `<button type="button" class="${classes}" data-slot-index="${index}">${escapeHtml(letter || '')}</button>`;
      })
      .join('');
  }

  if (clueMode === 'with') {
    hintEl.textContent = item.prompt ? `Ishora: ${item.prompt}` : "Sozlarni to'gri tartibda joylang.";
  } else {
    hintEl.textContent = '';
  }

  if (nextButton) {
    nextButton.textContent = state.currentIndex >= total - 1 ? 'Oxirgi savol' : 'Keyingi';
  }

  renderAnagramValidation();
  renderAnagramScore();
}

function fillAnagramSlot(letter, letterIndex, groupIndex = null) {
  const normalizedLetter = String(letter || '');
  if (!normalizedLetter) {
    return;
  }

  let firstEmptyIndex = -1;
  const resolvedGroup = Number.isInteger(groupIndex)
    ? state.currentWordGroups[groupIndex] || null
    : null;

  if (resolvedGroup) {
    for (let index = resolvedGroup.start; index < resolvedGroup.start + resolvedGroup.length; index += 1) {
      if (!state.currentSlots[index]) {
        firstEmptyIndex = index;
        break;
      }
    }
  }

  if (firstEmptyIndex < 0) {
    firstEmptyIndex = state.currentSlots.findIndex((slot) => !slot);
  }

  if (firstEmptyIndex < 0) {
    return;
  }

  state.currentSlots[firstEmptyIndex] = normalizedLetter;

  const preciseSelector = Number.isInteger(groupIndex)
    ? `.anagram-letter[data-group-index="${groupIndex}"][data-letter-index="${letterIndex}"]`
    : `.anagram-letter[data-letter-index="${letterIndex}"]`;
  const letterButton = document.querySelector(preciseSelector)
    || document.querySelector(`.anagram-letter[data-letter-index="${letterIndex}"]`);

  if (letterButton) {
    letterButton.disabled = true;
  }

  const slotButton = document.querySelector(`.anagram-slot[data-slot-index="${firstEmptyIndex}"]`);
  if (slotButton) {
    slotButton.textContent = normalizedLetter;
    slotButton.classList.add('filled');
  }

  persistCurrentAnagramAnswer();
  renderAnagramValidation();
  renderAnagramScore();
}

function clearAnagramSlot(slotIndex, groupIndex = null) {
  const letter = state.currentSlots[slotIndex];
  if (!letter) {
    return;
  }

  state.currentSlots[slotIndex] = '';

  const slotButton = document.querySelector(`.anagram-slot[data-slot-index="${slotIndex}"]`);
  if (slotButton) {
    slotButton.textContent = '';
    slotButton.classList.remove('filled');
  }

  const resolvedGroupIndex = Number.isInteger(groupIndex) ? groupIndex : getGroupIndexBySlotIndex(slotIndex);
  const letterButtons = Number.isInteger(resolvedGroupIndex)
    ? document.querySelectorAll(`.anagram-letter[data-group-index="${resolvedGroupIndex}"]`)
    : document.querySelectorAll('.anagram-letter');

  const candidate = Array.from(letterButtons).find((button) => {
      return button.disabled && String(button.textContent || '').toLowerCase() === letter.toLowerCase();
  });

  if (candidate) {
    candidate.disabled = false;
  }

  persistCurrentAnagramAnswer();
  renderAnagramValidation();
  renderAnagramScore();
}

function clearCurrentAnagramAnswer() {
  state.currentSlots = state.currentSlots.map(() => '');
  document.querySelectorAll('.anagram-slot').forEach((slot) => {
    slot.textContent = '';
    slot.classList.remove('filled');
  });
  document.querySelectorAll('.anagram-letter').forEach((letter) => {
    letter.disabled = false;
  });
  persistCurrentAnagramAnswer();
  renderAnagramValidation();
  renderAnagramScore();
}

function moveToNextAnagramItem() {
  const total = getActiveAnagramItems().length;
  if (total === 0) {
    return;
  }

  persistCurrentAnagramAnswer();
  if (state.currentIndex < total - 1) {
    state.currentIndex += 1;
    renderAnagramCurrentItem();
    return;
  }

  setStatus('Barcha savollar ochildi. Yakunlash tugmasini bosing.', 'info');
  renderAnagramValidation();
  renderLivePanel();
}

async function submitAnagramGame() {
  if (!state.setData) {
    setStatus('Avval mashqni yuklang.', 'error');
    return;
  }

  persistCurrentAnagramAnswer();

  const playerName = resolvePlayerName();
  if (!playerName) {
    setStatus('Ismingizni kiriting.', 'error');
    return;
  }

  const responses = getActiveAnagramItems()
    .map((item) => ({ itemId: item.id, answer: String(state.answersByItem.get(item.id) || '').trim() }))
    .filter((entry) => entry.answer);

  if (responses.length === 0) {
    setStatus('Kamida bitta javob kiriting.', 'error');
    return;
  }

  try {
    setStatus('Natijalar yuborilmoqda...', 'info');
    const payload = await request(`/wordwall/attempt/${state.setData.id}`, {
      method: 'POST',
      body: {
        playerName,
        responses,
      },
    });

    const result = payload.data;
    state.liveStatus = 'finished';
    stopAnagramTimer();
    setStatus(`Natija: ${result.score}% | Togri: ${result.correct}/${result.totalItems}`, 'success');
    renderAnagramScore();
    showAnagramCompletionModal({ playerName, result });
  } catch (error) {
    setStatus(error.message || 'Natijalar yuborilmadi.', 'error');
  }
}

function renderAnagramGame(setData) {
  const game = document.getElementById('anagram-game');
  const list = document.getElementById('set-items');
  if (!game || !list) {
    return;
  }

  state.answersByItem = new Map();
  state.currentIndex = 0;
  state.liveStatus = 'waiting';
  state.liveParticipantsCount = 0;
  state.liveParticipants = [];
  state.liveSessionId = null;
  hideAnagramCompletionModal();
  game.classList.remove('hidden');
  list.innerHTML = '';

  const items = getActiveAnagramItems();
  if (items.length === 0) {
    game.classList.add('hidden');
    list.innerHTML = '<article class="question-card">Anagram uchun savollar topilmadi.</article>';
    return;
  }

  startAnagramTimer();
  renderAnagramCurrentItem();
  startLiveParticipantsPolling();
}

function renderSet(setData) {
  const container = document.getElementById('wordwall-container');
  const title = document.getElementById('set-title');
  const meta = document.getElementById('set-meta');
  const list = document.getElementById('set-items');

  title.textContent = setData.title;
  meta.textContent = `Template: ${setData.template_type}`;

  const isAnagramTemplate = String(setData.template_type || '').toLowerCase() === 'anagram';
  if (isAnagramTemplate) {
    renderAnagramGame(setData);
    container.style.display = 'block';
    return;
  }

  const game = document.getElementById('anagram-game');
  if (game) {
    game.classList.add('hidden');
  }

  list.innerHTML = (setData.items || [])
    .map((item, index) => {
      const options = item.options && typeof item.options === 'object' ? item.options : null;

      if (options) {
        return `
          <article class="question-card" data-item-id="${item.id}">
            <p class="question-title">${index + 1}. ${escapeHtml(item.prompt)}</p>
            <div class="option-list">
              ${['A', 'B', 'C', 'D']
                .map(
                  (letter) => `
                    <label class="option-item">
                      <input type="radio" name="ww-${item.id}" value="${letter}" data-answer-option="${item.id}" />
                      <strong>${letter})</strong>
                      <span>${escapeHtml(options[letter] || '')}</span>
                    </label>
                  `
                )
                .join('')}
            </div>
          </article>
        `;
      }

      return `
        <article class="question-card" data-item-id="${item.id}">
          <p class="question-title">${index + 1}. ${escapeHtml(item.prompt)}</p>
          <input type="text" placeholder="Javobingiz" data-answer-input="${item.id}" />
        </article>
      `;
    })
    .join('');

  container.style.display = 'block';
}

async function loadSet() {
  const pinInput = document.getElementById('wordwall-pin-input');
  const pin = String(pinInput?.value || '').replace(/\D/g, '').slice(0, 5);
  if (pinInput) {
    pinInput.value = pin;
  }
  renderLivePanel();

  if (!/^\d{5}$/.test(pin)) {
    stopLiveParticipantsPolling();
    state.liveSessionId = null;
    state.liveParticipants = [];
    state.liveParticipantsCount = 0;
    renderLiveParticipantsList([]);
    setStatus('5 xonali oyin kodini kiriting.', 'error');
    return;
  }

  try {
    state.liveStatus = 'waiting';
    setStatus('Mashq yuklanmoqda...', 'info');
    renderLivePanel();
    const payload = await request(`/wordwall/public-by-pin/${pin}`);
    state.setData = payload.data;
    renderSet(payload.data);
    startLiveParticipantsPolling();
    setStatus('Mashq muvaffaqiyatli yuklandi.', 'success');
  } catch (error) {
    stopLiveParticipantsPolling();
    setStatus(error.message || 'Mashqni yuklab bolmadi.', 'error');
  }
}

function collectResponses() {
  if (!state.setData) {
    return [];
  }

  return (state.setData.items || [])
    .map((item) => {
      const hasOptions = item.options && typeof item.options === 'object';
      let answer = '';

      if (hasOptions) {
        const selected = document.querySelector(`input[name="ww-${item.id}"]:checked`);
        answer = selected ? selected.value.trim() : '';
      } else {
        const input = document.querySelector(`[data-answer-input="${item.id}"]`);
        answer = input ? input.value.trim() : '';
      }

      if (!answer) {
        return null;
      }
      return {
        itemId: item.id,
        answer,
      };
    })
    .filter(Boolean);
}

async function submitSet() {
  if (!state.setData) {
    setStatus('Avval mashqni yuklang.', 'error');
    return;
  }

  const playerName = document.getElementById('player-name-input').value.trim();
  if (!playerName) {
    setStatus('Ismingizni kiriting.', 'error');
    return;
  }

  const responses = collectResponses();
  if (responses.length === 0) {
    setStatus('Kamida bitta javob kiriting.', 'error');
    return;
  }

  try {
    setStatus('Javoblar yuborilmoqda...', 'info');
    const payload = await request(`/wordwall/attempt/${state.setData.id}`, {
      method: 'POST',
      body: {
        playerName,
        responses,
      },
    });

    const result = payload.data;
    setStatus(
      `Natija: ${result.score}% | Togri: ${result.correct}/${result.totalItems}`,
      'success'
    );
  } catch (error) {
    setStatus(error.message || 'Javob yuborilmadi.', 'error');
  }
}

document.getElementById('anagram-letters').addEventListener('click', (event) => {
  const letterButton = event.target.closest('.anagram-letter');
  if (!letterButton || letterButton.disabled) {
    return;
  }

  const letter = String(letterButton.textContent || '');
  const index = Number(letterButton.dataset.letterIndex);
  const groupIndex = Number.parseInt(letterButton.dataset.groupIndex || '', 10);
  fillAnagramSlot(letter, index, Number.isNaN(groupIndex) ? null : groupIndex);
});

document.getElementById('anagram-answer').addEventListener('click', (event) => {
  const letterButton = event.target.closest('.anagram-letter');
  if (letterButton && !letterButton.disabled) {
    const letter = String(letterButton.textContent || '');
    const index = Number(letterButton.dataset.letterIndex);
    const groupIndex = Number.parseInt(letterButton.dataset.groupIndex || '', 10);
    fillAnagramSlot(letter, index, Number.isNaN(groupIndex) ? null : groupIndex);
    return;
  }

  const slotButton = event.target.closest('.anagram-slot');
  if (!slotButton) {
    return;
  }

  const groupIndex = Number.parseInt(slotButton.dataset.groupIndex || '', 10);
  clearAnagramSlot(
    Number(slotButton.dataset.slotIndex),
    Number.isNaN(groupIndex) ? null : groupIndex
  );
});

document.getElementById('anagram-clear-btn').addEventListener('click', clearCurrentAnagramAnswer);
document.getElementById('anagram-shuffle-btn').addEventListener('click', renderAnagramCurrentItem);
document.getElementById('anagram-start-btn').addEventListener('click', startLiveSession);
document.getElementById('anagram-next-btn').addEventListener('click', moveToNextAnagramItem);
document.getElementById('anagram-finish-btn').addEventListener('click', submitAnagramGame);

const completionCloseBtn = document.getElementById('anagram-completion-close-btn');
if (completionCloseBtn) {
  completionCloseBtn.addEventListener('click', hideAnagramCompletionModal);
}

const completionOkBtn = document.getElementById('anagram-completion-ok-btn');
if (completionOkBtn) {
  completionOkBtn.addEventListener('click', hideAnagramCompletionModal);
}

const completionModal = document.getElementById('anagram-completion-modal');
if (completionModal) {
  completionModal.addEventListener('click', (event) => {
    if (event.target === completionModal) {
      hideAnagramCompletionModal();
    }
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    hideAnagramCompletionModal();
  }
});

document.getElementById('copy-live-pin-btn').addEventListener('click', copyLivePinCode);
document.getElementById('live-assign-link-btn').addEventListener('click', copyLiveAssignLink);
document.getElementById('live-host-btn').addEventListener('click', hostLiveSession);

document.getElementById('load-set-btn').addEventListener('click', loadSet);
document.getElementById('submit-set-btn').addEventListener('click', submitSet);

const pinInput = document.getElementById('wordwall-pin-input');
if (pinInput) {
  pinInput.addEventListener('input', () => {
    pinInput.value = pinInput.value.replace(/\D/g, '').slice(0, 5);
    renderLivePanel();
  });

  pinInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      loadSet();
    }
  });
}

const playerNameInput = document.getElementById('player-name-input');
if (playerNameInput) {
  playerNameInput.addEventListener('input', renderLivePanel);
}

resolvePlayerName();

const setPin = pageParams.get('pin');
if (setPin && pinInput) {
  pinInput.value = String(setPin).replace(/\D/g, '').slice(0, 5);
  loadSet();
}

const setId = pageParams.get('setId');
if (!setPin && setId) {
  const loadBySetId = async () => {
    try {
      setStatus('Mashq yuklanmoqda...', 'info');
      const payload = await request(`/wordwall/public/${setId}`);
      state.setData = payload.data;
      renderSet(payload.data);
      startLiveParticipantsPolling();
      setStatus('Mashq muvaffaqiyatli yuklandi.', 'success');
    } catch (error) {
      stopLiveParticipantsPolling();
      setStatus(error.message || 'Mashqni yuklab bolmadi.', 'error');
    }
  };

  loadBySetId();
}

if (isAutoplayMode) {
  const header = document.getElementById('wordwall-page-header');
  const entryPanel = document.getElementById('wordwall-entry-panel');
  const statusBox = document.getElementById('wordwall-status');

  if (header) {
    header.classList.add('hidden');
  }
  if (entryPanel) {
    entryPanel.classList.add('hidden');
  }
  if (statusBox) {
    statusBox.classList.add('hidden');
  }
}

renderLivePanel();

window.addEventListener('beforeunload', () => {
  stopAnagramTimer();
  stopLiveParticipantsPolling();
});

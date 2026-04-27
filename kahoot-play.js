const API_BASE =
  window.API_BASE_URL ||
  localStorage.getItem('eduskill.apiBase') ||
  'http://localhost:3001/api';

const state = {
  pin: '',
  playerName: '',
  joined: false,
  sessionStatus: 'draft',
  currentQuestion: null,
  answeredQuestionId: null,
  score: 0,
  pollTimer: null,
  localTimer: null,
  remainingSeconds: 0,
  timerTotalSeconds: 1,
};

const ui = {
  pinInput: document.getElementById('pin-input'),
  playerInput: document.getElementById('player-input'),
  joinBtn: document.getElementById('join-btn'),
  refreshBtn: document.getElementById('refresh-btn'),
  statusBox: document.getElementById('kahoot-status'),
  questionBox: document.getElementById('question-box'),
  answerFeedback: document.getElementById('answer-feedback'),
  answerTiles: document.getElementById('answer-tiles'),
  leaderboard: document.getElementById('leaderboard'),
  sessionStatus: document.getElementById('session-status'),
  questionProgress: document.getElementById('question-progress'),
  timerValue: document.getElementById('timer-value'),
  timerFill: document.getElementById('timer-fill'),
  myScore: document.getElementById('my-score'),
  summaryPanel: document.getElementById('summary-panel'),
  summaryScore: document.getElementById('summary-score'),
  summaryCorrect: document.getElementById('summary-correct'),
  summaryIncorrect: document.getElementById('summary-incorrect'),
  summaryRank: document.getElementById('summary-rank'),
};

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
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
  if (!ui.statusBox) {
    return;
  }

  ui.statusBox.className = `status-box status-${type}`;
  ui.statusBox.textContent = message;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setFeedback(message) {
  if (!ui.answerFeedback) {
    return;
  }

  ui.answerFeedback.textContent = message || '';
}

function setSummaryVisible(visible) {
  if (!ui.summaryPanel) {
    return;
  }

  ui.summaryPanel.classList.toggle('hidden', !visible);
}

function setAnswerButtonsDisabled(disabled) {
  document.querySelectorAll('.answer-tile').forEach((button) => {
    button.disabled = disabled;
  });
}

function setSessionStatus(status) {
  state.sessionStatus = status || 'draft';

  if (!ui.sessionStatus) {
    return;
  }

  const labels = {
    draft: 'kutilmoqda',
    live: 'jonli',
    finished: 'yakunlangan',
  };

  ui.sessionStatus.textContent = labels[state.sessionStatus] || state.sessionStatus;
}

function updateProgress(progress) {
  const current = Number(progress?.current || 0);
  const total = Number(progress?.total || 0);

  if (ui.questionProgress) {
    ui.questionProgress.textContent = `${current} / ${total}`;
  }
}

function updateScore(score) {
  state.score = Number(score || 0);
  if (ui.myScore) {
    ui.myScore.textContent = String(state.score);
  }
}

function stopLocalTimer() {
  if (state.localTimer) {
    clearInterval(state.localTimer);
    state.localTimer = null;
  }
}

function paintTimer(remainingSeconds, totalSeconds) {
  const total = Math.max(1, Number(totalSeconds || 1));
  const remaining = Math.max(0, Number(remainingSeconds || 0));

  if (ui.timerValue) {
    ui.timerValue.textContent = `${remaining}s`;
  }

  if (ui.timerFill) {
    const percent = Math.max(0, Math.min(100, (remaining / total) * 100));
    ui.timerFill.style.width = `${percent}%`;
  }
}

function startLocalTimer(remainingSeconds, totalSeconds) {
  stopLocalTimer();

  state.remainingSeconds = Math.max(0, Number(remainingSeconds || 0));
  state.timerTotalSeconds = Math.max(1, Number(totalSeconds || 1));
  paintTimer(state.remainingSeconds, state.timerTotalSeconds);

  if (state.remainingSeconds <= 0) {
    return;
  }

  state.localTimer = setInterval(() => {
    state.remainingSeconds = Math.max(0, state.remainingSeconds - 1);
    paintTimer(state.remainingSeconds, state.timerTotalSeconds);

    if (state.remainingSeconds <= 0) {
      stopLocalTimer();
      if (state.currentQuestion && state.answeredQuestionId !== state.currentQuestion.id) {
        setAnswerButtonsDisabled(true);
        setFeedback('Vaqt tugadi. Keyingi savolni kuting.');
      }
    }
  }, 1000);
}

function renderQuestion(question) {
  if (!ui.questionBox || !ui.answerTiles) {
    return;
  }

  if (!question) {
    ui.questionBox.textContent = 'Hozircha savol yoq yoki session boshlanmagan.';
    ui.answerTiles.style.display = 'none';
    return;
  }

  ui.questionBox.innerHTML = `
    <strong>${escapeHtml(question.questionText)}</strong>
    <div style="margin-top: 8px;">A) ${escapeHtml(question.optionA)}</div>
    <div>B) ${escapeHtml(question.optionB)}</div>
    <div>C) ${escapeHtml(question.optionC)}</div>
    <div>D) ${escapeHtml(question.optionD)}</div>
    <div style="margin-top: 8px;">Vaqt: ${question.timeLimitSeconds}s | Ball: ${question.points}</div>
  `;
  ui.answerTiles.style.display = 'grid';
  setAnswerButtonsDisabled(state.answeredQuestionId === question.id);
}

function renderLeaderboard(items) {
  if (!ui.leaderboard) {
    return;
  }

  const board = ui.leaderboard;
  if (!items || items.length === 0) {
    board.innerHTML = '<div class="leader-item"><span>Hali natijalar yoq</span></div>';
    return;
  }

  board.innerHTML = items
    .slice(0, 10)
    .map(
      (item, index) => `
        <div class="leader-item">
          <div>
            <strong>${index + 1}. ${escapeHtml(item.player_name)}</strong>
            <div class="leader-meta">✅ ${Number(item.correct_answers || 0)} | ❌ ${Number(item.incorrect_answers || 0)}</div>
          </div>
          <span>${Number(item.score || 0)} ball</span>
        </div>
      `
    )
    .join('');
}

function renderSummary(playerSummary, rank) {
  if (!playerSummary) {
    setSummaryVisible(false);
    return;
  }

  if (ui.summaryScore) {
    ui.summaryScore.textContent = String(Number(playerSummary.score || 0));
  }

  if (ui.summaryCorrect) {
    ui.summaryCorrect.textContent = String(Number(playerSummary.correctAnswers || 0));
  }

  if (ui.summaryIncorrect) {
    ui.summaryIncorrect.textContent = String(Number(playerSummary.incorrectAnswers || 0));
  }

  if (ui.summaryRank) {
    ui.summaryRank.textContent = rank ? `#${rank}` : '-';
  }

  setSummaryVisible(true);
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function normalizePin(value) {
  return String(value || '')
    .replace(/\D/g, '')
    .slice(0, 6);
}

async function pollLiveData() {
  if (!state.joined || !state.pin) {
    return;
  }

  try {
    const queryPlayerName = encodeURIComponent(state.playerName);

    const [questionPayload, leaderboardPayload] = await Promise.all([
      request(`/kahoot/live/${state.pin}/current-question?playerName=${queryPlayerName}`),
      request(`/kahoot/leaderboard/${state.pin}`),
    ]);

    const liveData = questionPayload.data || {};
    const session = liveData.session || {};
    const progress = liveData.progress || { current: 0, total: 0 };
    const leaderboard = Array.isArray(leaderboardPayload.data) ? leaderboardPayload.data : [];
    const playerSummary = liveData.playerSummary || null;

    setSessionStatus(session.status || 'draft');
    updateProgress(progress);

    if (playerSummary) {
      updateScore(playerSummary.score);
    }

    if (session.status === 'finished') {
      state.currentQuestion = null;
      state.answeredQuestionId = null;
      stopLocalTimer();
      paintTimer(0, 1);
      renderQuestion(null);
      setAnswerButtonsDisabled(true);
      setFeedback('Session yakunlandi. Yakuniy statistikani korishingiz mumkin.');
      setStatus('Session yakunlandi.', 'success');
      renderLeaderboard(liveData.leaderboard || leaderboard);
      renderSummary(playerSummary, liveData.rank);
      return;
    }

    setSummaryVisible(false);

    if (session.status === 'draft') {
      state.currentQuestion = null;
      state.answeredQuestionId = null;
      stopLocalTimer();
      paintTimer(0, 1);
      renderQuestion(null);
      setAnswerButtonsDisabled(true);
      setFeedback('Oqituvchi start bosishini kuting.');
      setStatus('Session hali boshlanmagan.', 'info');
      renderLeaderboard(leaderboard);
      return;
    }

    const question = liveData.question || null;
    const isNewQuestion = state.currentQuestion?.id !== question?.id;

    if (isNewQuestion) {
      state.currentQuestion = question;
      state.answeredQuestionId = null;
      setFeedback('');
    }

    if (liveData.alreadyAnswered && question) {
      state.answeredQuestionId = question.id;
    }

    renderQuestion(question);

    const remainingSeconds = Number(liveData.remainingSeconds || 0);
    startLocalTimer(remainingSeconds, Number(question?.timeLimitSeconds || 1));

    if (question) {
      const canAnswer = !liveData.alreadyAnswered && remainingSeconds > 0;
      setAnswerButtonsDisabled(!canAnswer);

      if (liveData.alreadyAnswered) {
        setFeedback('Javob qabul qilindi. Keyingi savolni kuting.');
      } else if (remainingSeconds <= 0) {
        setFeedback('Vaqt tugadi. Keyingi savolni kuting.');
      } else if (isNewQuestion) {
        setFeedback('Savol jonli! Javobni tanlang.');
      }

      setStatus(
        `Javoblar: ${Number(liveData.answerCount || 0)} / ${Number(liveData.participantCount || 0)}.`,
        'info'
      );
    }

    renderLeaderboard(leaderboard);
  } catch (error) {
    setStatus(error.message || 'Live malumotni olishda xato.', 'error');
  }
}

async function joinSession() {
  const pin = normalizePin(ui.pinInput?.value || '');
  const playerName = String(ui.playerInput?.value || '').trim();

  if (!pin || !playerName) {
    setStatus('PIN va ism majburiy.', 'error');
    return;
  }

  try {
    await request('/kahoot/join', {
      method: 'POST',
      body: { pin, playerName },
    });

    state.pin = pin;
    state.playerName = playerName;
    state.joined = true;
    state.currentQuestion = null;
    state.answeredQuestionId = null;
    updateScore(0);

    if (ui.pinInput) {
      ui.pinInput.value = pin;
    }

    setStatus('Sessionga muvaffaqiyatli kirdingiz.', 'success');

    stopPolling();
    state.pollTimer = setInterval(pollLiveData, 2000);
    await pollLiveData();
  } catch (error) {
    setStatus(error.message || 'Sessionga kirib bolmadi.', 'error');
  }
}

async function sendAnswer(selectedOption) {
  if (!state.joined || !state.currentQuestion) {
    setStatus('Avval sessionga kiring va savolni kuting.', 'error');
    return;
  }

  if (state.answeredQuestionId === state.currentQuestion.id) {
    setStatus('Bu savolga allaqachon javob yuborgansiz.', 'info');
    return;
  }

  if (state.remainingSeconds <= 0) {
    setStatus('Vaqt tugagan. Keyingi savolni kuting.', 'info');
    setAnswerButtonsDisabled(true);
    return;
  }

  try {
    setAnswerButtonsDisabled(true);
    setFeedback('Javob yuborilmoqda...');

    const payload = await request(`/kahoot/live/${state.pin}/answer`, {
      method: 'POST',
      body: {
        playerName: state.playerName,
        questionId: state.currentQuestion.id,
        selectedOption,
      },
    });

    state.answeredQuestionId = state.currentQuestion.id;

    if (payload.data?.playerSummary?.score !== undefined) {
      updateScore(payload.data.playerSummary.score);
    }

    if (payload.data?.isCorrect) {
      setFeedback(`Togri javob! +${Number(payload.data.pointsAwarded || 0)} ball`);
      setStatus('Javob qabul qilindi.', 'success');
    } else {
      setFeedback('Javob qabul qilindi. Keyingi savolni kuting.');
      setStatus('Javob qabul qilindi.', 'info');
    }

    await pollLiveData();
  } catch (error) {
    if (error.code === 'QUESTION_CLOSED') {
      setStatus('Bu savol yopilgan. Yangi savolni kuting.', 'info');
      setFeedback('Savol yopilgan yoki vaqt tugagan.');
      setAnswerButtonsDisabled(true);
      await pollLiveData();
      return;
    }

    if (error.code === 'ALREADY_ANSWERED') {
      state.answeredQuestionId = state.currentQuestion.id;
      setAnswerButtonsDisabled(true);
      setFeedback('Bu savolga javob yuborilgan.');
      setStatus('Bu savolga allaqachon javob yuborilgan.', 'info');
      return;
    }

    setStatus(error.message || 'Javob yuborilmadi.', 'error');
  }
}

if (ui.joinBtn) {
  ui.joinBtn.addEventListener('click', joinSession);
}

if (ui.refreshBtn) {
  ui.refreshBtn.addEventListener('click', pollLiveData);
}

if (ui.answerTiles) {
  ui.answerTiles.addEventListener('click', (event) => {
    const tile = event.target.closest('.answer-tile');
    if (!tile) {
      return;
    }

    sendAnswer(tile.dataset.option);
  });
}

window.addEventListener('beforeunload', () => {
  stopPolling();
  stopLocalTimer();
});

const params = new URLSearchParams(window.location.search);
const pinFromQuery = params.get('pin');
if (pinFromQuery && ui.pinInput) {
  ui.pinInput.value = normalizePin(pinFromQuery);
}

setAnswerButtonsDisabled(true);
setSummaryVisible(false);
paintTimer(0, 1);

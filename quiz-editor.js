const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

const state = {
  quizId: null,
  quiz: null,
  editingQuestionId: null,
  playsCount: 0,
  liveSession: null,
  livePollTimer: null,
  hostMode: false,
  liveParticipants: [],
};

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getQueryValue(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

function getQuizIdFromUrl() {
  return getQueryValue('quizId');
}

function isHostModeFromUrl() {
  return getQueryValue('host') === '1';
}

async function copyText(value) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const input = document.createElement('textarea');
  input.value = value;
  document.body.appendChild(input);
  input.select();
  document.execCommand('copy');
  document.body.removeChild(input);
}

function setUserInfo(user) {
  const roleEl = document.getElementById('qe-user-role');
  const emailEl = document.getElementById('qe-user-email');

  if (roleEl) {
    roleEl.textContent = String(user.role || 'user').toLowerCase();
  }
  if (emailEl) {
    emailEl.textContent = user.email || '';
  }
}

function buildPublicLink() {
  return new URL(`quiz-play.html?quizId=${state.quizId}`, window.location.href).href;
}

function setMeta() {
  if (!state.quiz) {
    return;
  }

  const titleEl = document.getElementById('qe-quiz-title');
  const descriptionEl = document.getElementById('qe-quiz-description');
  const questionCountEl = document.getElementById('qe-question-count');
  const playCountEl = document.getElementById('qe-play-count');
  const statusEl = document.getElementById('qe-status');

  titleEl.textContent = state.quiz.title;
  descriptionEl.textContent = `Kurs: ${state.quiz.course_title || '-'} | Muddat: ${state.quiz.time_limit_minutes || 15} daqiqa`;
  questionCountEl.textContent = `${state.quiz.questions.length} savol`;
  playCountEl.textContent = `${state.playsCount} play`;

  statusEl.textContent = state.quiz.is_published ? 'Faol' : 'Draft';
  statusEl.classList.toggle('active', Boolean(state.quiz.is_published));
}

function showModal(question = null) {
  state.editingQuestionId = question ? question.id : null;

  const modal = document.getElementById('qe-modal');
  if (!modal) {
    return;
  }

  modal.classList.remove('qe-hidden');

  if (!question) {
    document.getElementById('qe-question-text').value = '';
    document.getElementById('qe-points').value = 10;
    document.getElementById('qe-correct-option').value = 'A';
    OPTION_LETTERS.forEach((letter) => {
      document.getElementById(`qe-option-${letter}`).value = '';
    });
    return;
  }

  document.getElementById('qe-question-text').value = question.questionText || '';
  document.getElementById('qe-points').value = Number(question.points || 10);

  const correctOption = question.options.find((option) => option.isCorrect);
  document.getElementById('qe-correct-option').value =
    correctOption ? OPTION_LETTERS[Math.max(0, Number(correctOption.optionOrder) - 1)] : 'A';

  OPTION_LETTERS.forEach((letter, index) => {
    const input = document.getElementById(`qe-option-${letter}`);
    const option = (question.options || []).find((item) => Number(item.optionOrder) === index + 1);
    input.value = option ? option.optionText : '';
  });
}

function hideModal() {
  const modal = document.getElementById('qe-modal');
  if (!modal) {
    return;
  }

  modal.classList.add('qe-hidden');
  state.editingQuestionId = null;
}

function setEditMode(question) {
  state.editingQuestionId = question.id;
  showModal(question);
}

function resetForm() {
  document.getElementById('qe-question-text').value = '';
  document.getElementById('qe-points').value = 10;
  document.getElementById('qe-correct-option').value = 'A';

  OPTION_LETTERS.forEach((letter) => {
    const input = document.getElementById(`qe-option-${letter}`);
    input.value = '';
  });

  state.editingQuestionId = null;
}

function collectQuestionPayload() {
  const questionText = document.getElementById('qe-question-text').value.trim();
  const points = Number.parseInt(document.getElementById('qe-points').value || '10', 10);
  const correctLetter = document.getElementById('qe-correct-option').value || 'A';

  if (!questionText) {
    alert('Savol matnini kiriting.');
    return null;
  }

  const options = OPTION_LETTERS.map((letter) => ({
    text: document.getElementById(`qe-option-${letter}`).value.trim(),
    isCorrect: letter === correctLetter,
  }));

  if (options.some((option) => !option.text)) {
    alert('Barcha 4 variantni kiriting.');
    return null;
  }

  return {
    questionText,
    points: Number.isNaN(points) ? 10 : Math.max(1, points),
    options,
  };
}

function renderQuestions() {
  const list = document.getElementById('qe-question-list');
  if (!state.quiz || !list) {
    return;
  }

  if (!state.quiz.questions || state.quiz.questions.length === 0) {
    list.innerHTML = '<div class="qe-question-card"><div class="qe-question-inner"><p class="qe-muted">Bu papkada hali savol yoq.</p></div></div>';
    return;
  }

  list.innerHTML = state.quiz.questions
    .map(
      (question, index) => `
        <article class="qe-question-card">
          <div class="qe-question-inner">
            <div>
              <h4 class="qe-question-title">Question ${index + 1}</h4>
              <p class="qe-question-text">${escapeHtml(question.questionText)}</p>
            </div>
            <div class="qe-question-actions">
              <button class="qe-link-btn edit" data-action="edit" data-id="${question.id}">Edit</button>
              <button class="qe-link-btn delete" data-action="delete" data-id="${question.id}">Delete</button>
            </div>
          </div>
          <div class="qe-question-options">
            ${(question.options || [])
              .sort((a, b) => Number(a.optionOrder) - Number(b.optionOrder))
              .map(
                (option, optionIndex) => `
                  <div class="qe-question-option ${option.isCorrect ? 'correct' : ''}">
                    ${OPTION_LETTERS[optionIndex]}) ${escapeHtml(option.optionText)} ${
                      option.isCorrect ? '(to\'g\'ri)' : ''
                    }
                  </div>
                `
              )
              .join('')}
          </div>
        </article>
      `
    )
    .join('');
}

function setLivePanelVisible(visible) {
  const panel = document.getElementById('qe-live-panel');
  if (!panel) {
    return;
  }
  panel.classList.toggle('qe-hidden', !visible);
}

function setLiveButtonsState() {
  const createBtn = document.getElementById('qe-live-create');
  const restartBtn = document.getElementById('qe-live-restart');
  const startBtn = document.getElementById('qe-live-start');
  const nextBtn = document.getElementById('qe-live-next');
  const finishBtn = document.getElementById('qe-live-finish');
  const hasLive = Boolean(state.liveSession?.sessionId);
  const status = String(state.liveSession?.status || '').toLowerCase();
  const remainingSeconds = Math.max(0, Number(state.liveSession?.remainingSeconds || 0));

  if (createBtn) {
    createBtn.disabled = false;
  }
  if (restartBtn) {
    restartBtn.disabled = false;
  }
  if (startBtn) {
    startBtn.disabled = !hasLive || status === 'finished';
  }
  if (nextBtn) {
    nextBtn.disabled = !hasLive || status !== 'live' || remainingSeconds > 0;
  }
  if (finishBtn) {
    finishBtn.disabled = !hasLive || !['waiting', 'live'].includes(status);
  }
}

function renderLivePanel() {
  const codeEl = document.getElementById('qe-live-code');
  const statusEl = document.getElementById('qe-live-status');
  const playersEl = document.getElementById('qe-live-players');
  const progressEl = document.getElementById('qe-live-progress');
  const remainingEl = document.getElementById('qe-live-remaining');
  const listEl = document.getElementById('qe-live-players-list');

  if (!codeEl || !statusEl || !playersEl || !progressEl || !remainingEl || !listEl) {
    return;
  }

  const session = state.liveSession;
  if (!session) {
    codeEl.textContent = '-----';
    statusEl.textContent = 'no session';
    statusEl.classList.remove('live', 'finished');
    playersEl.textContent = "0 o'quvchi";
    progressEl.textContent = '0 / 0';
    remainingEl.textContent = '0s';
    listEl.innerHTML = '<li>Hali ishtirokchi yoq</li>';
    setLiveButtonsState();
    return;
  }

  codeEl.textContent = session.code || '-----';
  statusEl.textContent = String(session.status || 'waiting').toLowerCase();
  statusEl.classList.toggle('live', statusEl.textContent === 'live');
  statusEl.classList.toggle('finished', statusEl.textContent === 'finished');
  playersEl.textContent = `${Number(session.participantsCount || 0)} o'quvchi`;
  progressEl.textContent = `${Number(session.currentQuestionIndex || 0)} / ${Number(session.totalQuestions || 0)}`;
  remainingEl.textContent = `${Math.max(0, Number(session.remainingSeconds || 0))}s`;

  if (!state.liveParticipants || state.liveParticipants.length === 0) {
    listEl.innerHTML = '<li>Hali ishtirokchi yoq</li>';
  } else {
    listEl.innerHTML = state.liveParticipants
      .slice(0, 12)
      .map((player, index) => {
        const fullName = escapeHtml(player.user_full_name || player.player_name || 'Noma\'lum');
        const login = escapeHtml(player.user_email || 'email mavjud emas');
        const score = Number(player.score || 0);
        const correct = Number(player.correct_answers || 0);
        const incorrect = Number(player.incorrect_answers || 0);
        return `<li>${index + 1}. ${fullName} (${login}) - ${score} ball | To'g'ri: ${correct} | Noto'g'ri: ${incorrect}</li>`;
      })
      .join('');
  }

  setLiveButtonsState();
}

function startLivePolling() {
  if (state.livePollTimer) {
    clearInterval(state.livePollTimer);
  }

  state.livePollTimer = setInterval(() => {
    monitorLiveSession(false);
  }, 2000);
}

function stopLivePolling() {
  if (state.livePollTimer) {
    clearInterval(state.livePollTimer);
    state.livePollTimer = null;
  }
}

async function loadQuizSummary() {
  try {
    const payload = await window.eduAuth.apiRequest('/quiz');
    const item = (payload.data || []).find((quiz) => quiz.id === state.quizId);
    state.playsCount = Number(item?.plays_count || 0);
  } catch (error) {
    state.playsCount = 0;
  }
}

async function loadQuiz() {
  const [payload] = await Promise.all([
    window.eduAuth.apiRequest(`/quiz/${state.quizId}`),
    loadQuizSummary(),
  ]);
  state.quiz = payload.data;
  setMeta();
  renderQuestions();
}

async function loadExistingLiveSession() {
  try {
    const payload = await window.eduAuth.apiRequest(`/quiz/${state.quizId}/live/session`);
    if (!payload.data) {
      state.liveSession = null;
      state.liveParticipants = [];
      renderLivePanel();
      return;
    }

    state.liveSession = {
      sessionId: payload.data.sessionId,
      code: payload.data.code,
      status: payload.data.status,
      currentQuestionIndex: payload.data.currentQuestionIndex,
      questionTimeSeconds: payload.data.questionTimeSeconds,
      participantsCount: payload.data.participantsCount,
      remainingSeconds: payload.data.remainingSeconds,
      totalQuestions: state.quiz?.questions?.length || 0,
    };
    state.liveParticipants = [];

    setLivePanelVisible(true);
    renderLivePanel();

    if (['waiting', 'live'].includes(String(state.liveSession.status || '').toLowerCase())) {
      startLivePolling();
      await monitorLiveSession(false);
    }
  } catch (error) {
    state.liveSession = null;
    renderLivePanel();
  }
}

async function monitorLiveSession(showError = true) {
  if (!state.liveSession?.sessionId) {
    return;
  }

  try {
    const payload = await window.eduAuth.apiRequest(`/quiz/live/${state.liveSession.sessionId}/monitor`);
    const data = payload.data || {};
    state.liveSession = {
      ...state.liveSession,
      sessionId: data.sessionId || state.liveSession.sessionId,
      code: data.code || state.liveSession.code,
      status: data.status || state.liveSession.status,
      currentQuestionIndex: Number(data.currentQuestionIndex || 0),
      totalQuestions: Number(data.totalQuestions || state.quiz?.questions?.length || 0),
      questionTimeSeconds: Number(data.questionTimeSeconds || state.liveSession.questionTimeSeconds || 30),
      remainingSeconds: Number(data.remainingSeconds || 0),
      participantsCount: Number(data.participantsCount || 0),
    };
    state.liveParticipants = Array.isArray(data.participants) ? data.participants : [];

    renderLivePanel();

    if (String(state.liveSession.status || '').toLowerCase() === 'finished') {
      stopLivePolling();
    }
  } catch (error) {
    if (showError) {
      alert(error.message || 'Live session holati yuklanmadi.');
    }
  }
}

async function createLiveSession(options = {}) {
  const modalTimeInput = document.getElementById('qe-time-limit');
  const defaultSeconds = Number.parseInt(String(state.liveSession?.questionTimeSeconds || modalTimeInput?.value || 30), 10);
  const preferredSeconds = Number.parseInt(String(options.timePerQuestion ?? defaultSeconds), 10);
  const timePerQuestion = Math.max(5, Math.min(120, Number.isNaN(preferredSeconds) ? 30 : preferredSeconds));
  const silent = Boolean(options.silent);

  try {
    const payload = await window.eduAuth.apiRequest(`/quiz/${state.quizId}/live/session`, {
      method: 'POST',
      body: { timePerQuestion },
    });

    state.liveSession = {
      sessionId: payload.data.sessionId,
      code: payload.data.code,
      status: payload.data.status,
      currentQuestionIndex: payload.data.currentQuestionIndex,
      questionTimeSeconds: payload.data.questionTimeSeconds,
      participantsCount: 0,
      remainingSeconds: payload.data.questionTimeSeconds,
      totalQuestions: payload.data.totalQuestions || state.quiz?.questions?.length || 0,
    };
    state.liveParticipants = [];

    setLivePanelVisible(true);
    renderLivePanel();
    startLivePolling();

    try {
      await copyText(state.liveSession.code);
    } catch (error) {
      // Clipboard fallback is handled in copyText.
    }

    if (!silent) {
      alert(`Live session yaratildi. Kod: ${state.liveSession.code}`);
    }

    return state.liveSession;
  } catch (error) {
    if (!silent) {
      alert(error.message || 'Live session yaratilmadi.');
    }

    throw error;
  }
}

async function startLiveSession() {
  if (!state.liveSession?.sessionId) {
    try {
      await createLiveSession({ silent: true });
    } catch (error) {
      alert(error.message || 'Live session yaratilmadi.');
      return;
    }
  }

  if (!state.liveSession?.sessionId) {
    alert('Live session yaratilmadi.');
    return;
  }

  try {
    const payload = await window.eduAuth.apiRequest(`/quiz/live/${state.liveSession.sessionId}/start`, {
      method: 'POST',
    });
    state.liveSession = {
      ...state.liveSession,
      status: payload.data.status,
      currentQuestionIndex: payload.data.currentQuestionIndex,
      questionTimeSeconds: payload.data.questionTimeSeconds,
      totalQuestions: payload.data.totalQuestions || state.liveSession.totalQuestions,
      remainingSeconds: payload.data.questionTimeSeconds,
    };

    renderLivePanel();
    startLivePolling();
    await monitorLiveSession(false);
  } catch (error) {
    alert(error.message || 'Sessionni boshlab bolmadi.');
  }
}

async function restartLiveCode() {
  try {
    await createLiveSession({ silent: false });
  } catch (error) {
    alert(error.message || 'Kodni yangilab bolmadi.');
  }
}

async function nextLiveQuestion() {
  if (!state.liveSession?.sessionId) {
    return;
  }

  try {
    const payload = await window.eduAuth.apiRequest(`/quiz/live/${state.liveSession.sessionId}/next`, {
      method: 'POST',
    });

    state.liveSession = {
      ...state.liveSession,
      status: payload.data.status,
      currentQuestionIndex: payload.data.currentQuestionIndex,
      questionTimeSeconds: payload.data.questionTimeSeconds || state.liveSession.questionTimeSeconds,
      totalQuestions: payload.data.totalQuestions || state.liveSession.totalQuestions,
      remainingSeconds: payload.data.status === 'finished' ? 0 : payload.data.questionTimeSeconds,
    };

    renderLivePanel();
    if (payload.data.status === 'finished') {
      stopLivePolling();
      return;
    }
    await monitorLiveSession(false);
  } catch (error) {
    alert(error.message || 'Keyingi savolga otib bolmadi.');
  }
}

async function finishLiveSession() {
  if (!state.liveSession?.sessionId) {
    return;
  }

  try {
    await window.eduAuth.apiRequest(`/quiz/live/${state.liveSession.sessionId}/finish`, {
      method: 'POST',
    });

    state.liveSession = {
      ...state.liveSession,
      status: 'finished',
      remainingSeconds: 0,
    };

    renderLivePanel();
    stopLivePolling();
  } catch (error) {
    alert(error.message || 'Sessionni yakunlab bolmadi.');
  }
}

async function copyLiveCode() {
  const status = String(state.liveSession?.status || '').toLowerCase();
  if (!state.liveSession?.code || status === 'finished') {
    try {
      await createLiveSession({ silent: true });
    } catch (error) {
      const isAdminAccessError =
        error?.code === 'FORBIDDEN' || /Administrator access required/i.test(String(error?.message || ''));

      if (isAdminAccessError) {
        alert(
          "Administrator access required. Bu tabda sessiya student bo'lib qolgan. Admin hisobidan qayta login qiling yoki admin/student ni alohida brauzer oynalarida oching."
        );
        return;
      }

      const backendHint =
        'Live kod yaratib bo\'lmadi. Backend serverni qayta ishga tushiring (API) va qayta urinib ko\'ring.';
      alert(error.message ? `${error.message}\n\n${backendHint}` : backendHint);
      return;
    }
  }

  if (!state.liveSession?.code) {
    alert('Live kod yaratib bo\'lmadi.');
    return;
  }

  try {
    await copyText(state.liveSession.code);
    alert(`Kod nusxalandi: ${state.liveSession.code}`);
  } catch (error) {
    alert('Kod nusxalanmadi.');
  }
}

async function saveQuestion() {
  const body = collectQuestionPayload();
  if (!body) {
    return;
  }

  try {
    if (state.editingQuestionId) {
      await window.eduAuth.apiRequest(`/quiz/${state.quizId}/questions/${state.editingQuestionId}`, {
        method: 'PUT',
        body,
      });
    } else {
      await window.eduAuth.apiRequest(`/quiz/${state.quizId}/questions`, {
        method: 'POST',
        body,
      });
    }

    await loadQuiz();
    if (state.liveSession) {
      state.liveSession.totalQuestions = state.quiz?.questions?.length || state.liveSession.totalQuestions;
      renderLivePanel();
    }
    resetForm();
    hideModal();
  } catch (error) {
    alert(error.message || 'Savol saqlanmadi.');
  }
}

async function deleteQuestion(questionId) {
  if (!confirm('Savolni ochirishni tasdiqlaysizmi?')) {
    return;
  }

  try {
    await window.eduAuth.apiRequest(`/quiz/${state.quizId}/questions/${questionId}`, {
      method: 'DELETE',
    });

    await loadQuiz();
    if (state.liveSession) {
      state.liveSession.totalQuestions = state.quiz?.questions?.length || state.liveSession.totalQuestions;
      renderLivePanel();
    }
    if (state.editingQuestionId === questionId) {
      resetForm();
    }
  } catch (error) {
    alert(error.message || 'Savol ochirilmadi.');
  }
}

async function publishQuiz() {
  try {
    await window.eduAuth.apiRequest(`/quiz/${state.quizId}/publish`, {
      method: 'POST',
    });
    await loadQuiz();
    alert('Quiz publish qilindi.');
  } catch (error) {
    alert(error.message || 'Quiz publish qilinmadi.');
  }
}

async function assignLiveCode() {
  await copyLiveCode();
}

async function openHostLink() {
  setLivePanelVisible(true);
  if (!state.liveSession || String(state.liveSession.status || '').toLowerCase() === 'finished') {
    try {
      await createLiveSession({ silent: true });
    } catch (error) {
      alert(error.message || 'Live session yaratilmadi.');
    }
    return;
  }

  renderLivePanel();
  startLivePolling();
  await monitorLiveSession(false);
}

function bindEvents() {
  document.getElementById('qe-add-question-btn').addEventListener('click', () => {
    resetForm();
    showModal();
  });

  document.getElementById('qe-modal-save').addEventListener('click', saveQuestion);
  document.getElementById('qe-modal-cancel').addEventListener('click', () => {
    resetForm();
    hideModal();
  });

  document.getElementById('qe-publish-btn').addEventListener('click', publishQuiz);
  document.getElementById('qe-copy-link-btn').addEventListener('click', assignLiveCode);
  document.getElementById('qe-open-play-btn').addEventListener('click', openHostLink);
  document.getElementById('qe-copy-code-btn').addEventListener('click', copyLiveCode);
  document.getElementById('qe-live-create').addEventListener('click', createLiveSession);
  document.getElementById('qe-live-restart').addEventListener('click', restartLiveCode);
  document.getElementById('qe-live-start').addEventListener('click', startLiveSession);
  document.getElementById('qe-live-next').addEventListener('click', nextLiveQuestion);
  document.getElementById('qe-live-finish').addEventListener('click', finishLiveSession);
  document.getElementById('qe-logout').addEventListener('click', () => {
    stopLivePolling();
    logout();
  });

  document.getElementById('qe-modal').addEventListener('click', (event) => {
    if (event.target.id === 'qe-modal') {
      hideModal();
    }
  });

  document.getElementById('qe-question-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) {
      return;
    }

    const { action, id } = button.dataset;
    if (!id) {
      return;
    }

    if (action === 'edit') {
      const question = (state.quiz?.questions || []).find((item) => item.id === id);
      if (question) {
        setEditMode(question);
      }
      return;
    }

    if (action === 'delete') {
      deleteQuestion(id);
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await checkAuth('admin');
  if (!user) {
    return;
  }

  setUserInfo(user);
  state.quizId = getQuizIdFromUrl();
  state.hostMode = isHostModeFromUrl();

  if (!state.quizId) {
    alert('Quiz ID topilmadi.');
    window.location.href = 'dashboard.html';
    return;
  }

  bindEvents();
  resetForm();
  renderLivePanel();

  try {
    await loadQuiz();
    await loadExistingLiveSession();

    if (state.hostMode) {
      await openHostLink();
    }
  } catch (error) {
    alert(error.message || 'Quiz yuklanmadi.');
    window.location.href = 'dashboard.html';
  }

  window.addEventListener('beforeunload', () => {
    stopLivePolling();
  });
});

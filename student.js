const LIVE_CODE_STORAGE_KEY = 'eduskill.liveQuizCode';
const WORDWALL_LIVE_CODE_STORAGE_KEY = 'eduskill.liveWordwallCode';

document.addEventListener('DOMContentLoaded', async () => {
  const user = await checkAuth('student');
  if (!user) {
    return;
  }

  const ui = {
    role: document.getElementById('student-role'),
    email: document.getElementById('student-email'),
    status: document.getElementById('student-status'),
    joinGrid: document.getElementById('student-join-grid'),
    codeInput: document.getElementById('student-quiz-code'),
    joinBtn: document.getElementById('join-live-quiz'),
    wordwallCodeInput: document.getElementById('student-wordwall-code'),
    wordwallNameInput: document.getElementById('student-wordwall-name'),
    wordwallJoinBtn: document.getElementById('join-wordwall-live'),
    panel: document.getElementById('live-quiz-panel'),
    title: document.getElementById('live-quiz-title'),
    codeLabel: document.getElementById('live-quiz-code-label'),
    waitingBox: document.getElementById('live-waiting-box'),
    waitingMessage: document.getElementById('live-waiting-message'),
    questionBox: document.getElementById('live-question-box'),
    finishedBox: document.getElementById('live-finished-box'),
    progressLabel: document.getElementById('live-progress-label'),
    scoreLabel: document.getElementById('live-score-label'),
    timerValue: document.getElementById('live-timer-value'),
    timerFill: document.getElementById('live-timer-fill'),
    questionText: document.getElementById('live-question-text'),
    options: document.getElementById('live-options'),
    feedback: document.getElementById('live-answer-feedback'),
    nextActionsWrap: document.getElementById('live-next-actions'),
    nextBtn: document.getElementById('live-next-btn'),
    finalScore: document.getElementById('live-final-score'),
    finalStats: document.getElementById('live-final-stats'),
    leaderboard: document.getElementById('live-leaderboard'),
    clearResultBtn: document.getElementById('clear-student-result-btn'),
    quizCompletionModal: document.getElementById('quiz-completion-modal'),
    quizCompletionTitle: document.getElementById('quiz-completion-title'),
    quizCompletionSubtitle: document.getElementById('quiz-completion-subtitle'),
    quizCompletionScore: document.getElementById('quiz-completion-score'),
    quizCompletionCorrect: document.getElementById('quiz-completion-correct'),
    quizCompletionWrong: document.getElementById('quiz-completion-wrong'),
    quizCompletionNote: document.getElementById('quiz-completion-note'),
    quizCompletionCloseBtn: document.getElementById('quiz-completion-close-btn'),
    quizCompletionOkBtn: document.getElementById('quiz-completion-ok-btn'),
  };

  const liveState = {
    code: null,
    pollTimer: null,
    currentQuestionId: null,
    selectedOptionId: null,
    answerSubmitting: false,
    nextSubmitting: false,
    resultDeleteSubmitting: false,
    completionModalShown: false,
  };

  const wordwallLiveState = {
    code: null,
    playerName: '',
    pollTimer: null,
  };

  if (ui.wordwallNameInput && !ui.wordwallNameInput.value.trim()) {
    ui.wordwallNameInput.value = String(user.name || user.email || '').trim();
  }

  if (ui.role) {
    ui.role.textContent = "O'quvchi rejimi";
  }
  if (ui.email) {
    ui.email.textContent = user.email;
  }

  const studentDisplayName =
    String(user.name || user.email || "o'quvchi")
      .trim()
      .replace(/\s+/g, ' ') || "o'quvchi";

  const setStatus = (message) => {
    if (ui.status) {
      ui.status.textContent = message;
    }
  };

  const setResultDeleteBusy = (busy, text = "Natijani o'chirish") => {
    if (!ui.clearResultBtn) {
      return;
    }

    ui.clearResultBtn.disabled = busy;
    ui.clearResultBtn.textContent = busy ? text : "Natijani o'chirish";
  };

  const setPanelVisible = (visible) => {
    if (!ui.panel) {
      return;
    }
    ui.panel.classList.toggle('student-hidden', !visible);
    if (ui.joinGrid) {
      ui.joinGrid.classList.toggle('student-quiz-focus', Boolean(visible));
    }
  };

  const sanitizeCode = (value) => String(value || '').replace(/\D/g, '').slice(0, 5);

  const setMode = (mode) => {
    if (ui.waitingBox) {
      ui.waitingBox.classList.toggle('student-hidden', mode !== 'waiting');
    }
    if (ui.questionBox) {
      ui.questionBox.classList.toggle('student-hidden', mode !== 'live');
    }
    if (ui.finishedBox) {
      ui.finishedBox.classList.toggle('student-hidden', mode !== 'finished');
    }
  };

  const renderLeaderboard = (rows) => {
    if (!ui.leaderboard) {
      return;
    }

    const list = Array.isArray(rows) ? rows.slice(0, 10) : [];
    if (list.length === 0) {
      ui.leaderboard.innerHTML = '<li>Hali natijalar yoq</li>';
      return;
    }

    ui.leaderboard.innerHTML = list
      .map((item, index) => `<li>${index + 1}. ${item.player_name} - ${item.score} ball</li>`)
      .join('');
  };

  const updateCommon = (data) => {
    if (!data) {
      return;
    }

    if (ui.title) {
      ui.title.textContent = data.quizTitle || 'Jonli Quiz';
    }
    if (ui.codeLabel) {
      ui.codeLabel.textContent = `Kod: ${data.code || liveState.code || '-----'}`;
    }
    if (ui.progressLabel) {
      ui.progressLabel.textContent = `${Number(data.currentQuestionIndex || 0)} / ${Number(data.totalQuestions || 0)}`;
    }
    if (ui.scoreLabel) {
      ui.scoreLabel.textContent = `${Number(data.participant?.score || 0)} ball`;
    }
  };

  const updateTimer = (remainingSeconds, totalSeconds) => {
    const total = Math.max(1, Number(totalSeconds || 30));
    const remaining = Math.max(0, Number(remainingSeconds || 0));
    if (ui.timerValue) {
      ui.timerValue.textContent = `${remaining}s`;
    }
    if (ui.timerFill) {
      const percent = Math.max(0, Math.min(100, (remaining / total) * 100));
      ui.timerFill.style.width = `${percent}%`;
    }
  };

  const stopPolling = () => {
    if (liveState.pollTimer) {
      clearInterval(liveState.pollTimer);
      liveState.pollTimer = null;
    }
  };

  const stopWordwallPolling = () => {
    if (wordwallLiveState.pollTimer) {
      clearInterval(wordwallLiveState.pollTimer);
      wordwallLiveState.pollTimer = null;
    }
  };

  const persistCode = (code) => {
    localStorage.setItem(LIVE_CODE_STORAGE_KEY, code);
  };

  const clearPersistedCode = () => {
    localStorage.removeItem(LIVE_CODE_STORAGE_KEY);
  };

  const persistWordwallCode = (code) => {
    localStorage.setItem(WORDWALL_LIVE_CODE_STORAGE_KEY, code);
  };

  const clearPersistedWordwallCode = () => {
    localStorage.removeItem(WORDWALL_LIVE_CODE_STORAGE_KEY);
  };

  const hideQuizCompletionModal = () => {
    if (!ui.quizCompletionModal) {
      return;
    }

    ui.quizCompletionModal.classList.add('student-hidden');
    ui.quizCompletionModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('student-modal-open');
  };

  const showQuizCompletionModal = (data) => {
    if (!ui.quizCompletionModal || liveState.completionModalShown) {
      return;
    }

    const score = Number(data?.participant?.score || 0);
    const summary = data?.summary || {};
    const correctAnswers = Number(summary.correctAnswers || 0);
    const incorrectAnswers = Number(summary.incorrectAnswers || 0);
    const totalQuestions = Math.max(0, Number(data?.totalQuestions || correctAnswers + incorrectAnswers || 0));
    const accuracy = totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : 0;

    if (ui.quizCompletionTitle) {
      ui.quizCompletionTitle.textContent = `Ajoyib, ${studentDisplayName}!`;
    }
    if (ui.quizCompletionSubtitle) {
      ui.quizCompletionSubtitle.textContent = `${data?.quizTitle || 'Jonli Quiz'} yakunlandi. Natijangiz tayyor.`;
    }
    if (ui.quizCompletionScore) {
      ui.quizCompletionScore.textContent = `Natija: ${score} ball`;
    }
    if (ui.quizCompletionCorrect) {
      ui.quizCompletionCorrect.textContent = `To'g'ri: ${correctAnswers}`;
    }
    if (ui.quizCompletionWrong) {
      ui.quizCompletionWrong.textContent = `Noto'g'ri: ${incorrectAnswers}`;
    }
    if (ui.quizCompletionNote) {
      if (accuracy >= 90) {
        ui.quizCompletionNote.textContent = `Zo'r natija! Aniqlik darajasi: ${accuracy}%`;
      } else if (accuracy >= 70) {
        ui.quizCompletionNote.textContent = `Yaxshi ishladingiz! Aniqlik darajasi: ${accuracy}%`;
      } else {
        ui.quizCompletionNote.textContent = `Yakunladingiz! Keyingi urinishda ${accuracy}% dan ham yuqoriga chiqasiz.`;
      }
    }

    ui.quizCompletionModal.classList.remove('student-hidden');
    ui.quizCompletionModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('student-modal-open');
    liveState.completionModalShown = true;
  };

  const renderOptions = (data) => {
    if (!ui.options || !data?.question) {
      return;
    }

    const options = (data.question.options || []).slice().sort((a, b) => Number(a.optionOrder) - Number(b.optionOrder));
    const disabled = Boolean(data.alreadyAnswered) || liveState.answerSubmitting;

    ui.options.innerHTML = options
      .map((option, index) => {
        const optionLetter = String.fromCharCode(65 + index);
        const selectedClass = liveState.selectedOptionId === option.id ? 'selected' : '';
        return `
          <button
            type="button"
            class="student-live-option-btn ${selectedClass}"
            data-option-id="${option.id}"
            ${disabled ? 'disabled' : ''}
          >
            ${optionLetter}) ${option.optionText}
          </button>
        `;
      })
      .join('');
  };

  const setNextButton = (visible, disabled = false) => {
    if (ui.nextActionsWrap) {
      ui.nextActionsWrap.classList.toggle('student-hidden', !visible);
    }

    if (!ui.nextBtn) {
      return;
    }

    ui.nextBtn.classList.toggle('student-hidden', !visible);
    ui.nextBtn.disabled = !visible || disabled;
  };

  const renderWaiting = () => {
    setMode('waiting');
    setNextButton(false);
    if (ui.waitingMessage) {
      ui.waitingMessage.textContent =
        "Hotirjam bo'ling, sizning so'rovingiz qabul qilindi. Tez orada quiz testlar boshlanadi.";
    }
    if (ui.feedback) {
      ui.feedback.textContent = '';
    }
  };

  const renderLive = (data) => {
    setMode('live');

    if (!data.question) {
      renderWaiting();
      return;
    }

    if (liveState.currentQuestionId !== data.question.id) {
      liveState.currentQuestionId = data.question.id;
      liveState.selectedOptionId = null;
      if (ui.feedback) {
        ui.feedback.textContent = '';
      }
    }

    if (ui.questionText) {
      ui.questionText.textContent = data.question.questionText || 'Savol';
    }

    updateTimer(data.remainingSeconds, data.questionTimeSeconds);
    renderOptions(data);
    setNextButton(Boolean(data.canGoNext), liveState.nextSubmitting);

    if (data.alreadyAnswered && ui.feedback && !ui.feedback.textContent) {
      ui.feedback.textContent = data.canGoNext
        ? "Javobingiz qabul qilindi. Keyingi savol tugmasini bosing."
        : "Javobingiz qabul qilindi. Boshqa o'quvchilar javob berishini kuting.";
    }

    const safeRemainingSeconds = Number(data.remainingSeconds || 0);
    if (!data.alreadyAnswered && safeRemainingSeconds <= 0 && ui.feedback && !liveState.nextSubmitting) {
      ui.feedback.textContent = "Vaqt tugadi. Bonus berilmaydi, variantni tanlab javob yuboring.";
    }
  };

  const renderFinished = (data) => {
    setMode('finished');
    setNextButton(false);
    clearPersistedCode();
    if (ui.finalScore) {
      ui.finalScore.textContent = `Sizning natijangiz: ${Number(data.participant?.score || 0)} ball`;
    }
    if (ui.finalStats) {
      const summary = data.summary || {};
      ui.finalStats.textContent = `To'g'ri: ${Number(summary.correctAnswers || 0)} | Noto'g'ri: ${Number(summary.incorrectAnswers || 0)}`;
    }
    renderLeaderboard(data.leaderboard);
    showQuizCompletionModal(data);
  };

  const loadLiveState = async (showError = false) => {
    if (!liveState.code) {
      return;
    }

    try {
      const payload = await window.eduAuth.apiRequest(`/quiz/live/${encodeURIComponent(liveState.code)}/state`);
      const data = payload.data || {};

      setPanelVisible(true);
      updateCommon(data);

      if (data.status === 'finished') {
        renderFinished(data);
        stopPolling();
        setStatus('Quiz yakunlandi. Natijalar yuqorida ko\'rsatilgan.');
      } else if (data.status === 'live') {
        renderLive(data);
        setStatus('Quiz boshlandi. Savolga javob bering.');
      } else {
        renderWaiting();
        setStatus("Hotirjam bo'ling, so'rovingiz qabul qilindi. Admin start berishini kuting.");
      }

      if (data.code) {
        liveState.code = data.code;
        persistCode(data.code);
      }
    } catch (error) {
      if (showError) {
        setStatus(error.message || 'Jonli quiz holatini olib bolmadi.');
      }
      if (error.code === 'NOT_FOUND' || error.code === 'NOT_JOINED') {
        clearPersistedCode();
      }
    }
  };

  const submitAnswer = async (optionId) => {
    if (!liveState.code || !optionId || liveState.answerSubmitting) {
      return;
    }

    liveState.selectedOptionId = optionId;
    liveState.answerSubmitting = true;
    if (ui.feedback) {
      ui.feedback.textContent = 'Javob yuborilmoqda...';
    }

    try {
      const payload = await window.eduAuth.apiRequest(`/quiz/live/${encodeURIComponent(liveState.code)}/answer`, {
        method: 'POST',
        body: { optionId },
      });
      const data = payload.data || {};

      if (ui.feedback) {
        if (data.alreadyAnswered) {
          ui.feedback.textContent = 'Bu savolga allaqachon javob bergansiz.';
        } else if (data.timeExpired || data.accepted === false) {
          ui.feedback.textContent = 'Vaqt tugadi. Bu savol qabul qilinmadi.';
        } else if (data.isCorrect) {
          ui.feedback.textContent = `To'g'ri javob! +${Number(data.awarded || 0)} ball`;
        } else {
          ui.feedback.textContent = "Noto'g'ri javob. Keyingi savolda omad!";
        }
      }

      await loadLiveState(false);
    } catch (error) {
      if (ui.feedback) {
        ui.feedback.textContent = error.message || 'Javob yuborilmadi.';
      }
    } finally {
      liveState.answerSubmitting = false;
    }
  };

  const goNextQuestion = async () => {
    if (!liveState.code || liveState.nextSubmitting) {
      return;
    }

    liveState.nextSubmitting = true;
    setNextButton(true, true);

    try {
      const payload = await window.eduAuth.apiRequest(`/quiz/live/${encodeURIComponent(liveState.code)}/next`, {
        method: 'POST',
      });

      if (payload.data?.status === 'finished') {
        await loadLiveState(false);
        return;
      }

      if (ui.feedback) {
        ui.feedback.textContent = '';
      }
      await loadLiveState(false);
    } catch (error) {
      setStatus(error.message || 'Keyingi savolga otib bolmadi.');
    } finally {
      liveState.nextSubmitting = false;
      await loadLiveState(false);
    }
  };

  const startPolling = () => {
    stopPolling();
    liveState.pollTimer = setInterval(() => {
      loadLiveState(false);
    }, 1500);
  };

  const loadWordwallLiveState = async (showError = false) => {
    if (!wordwallLiveState.code) {
      return;
    }

    try {
      const payload = await window.eduAuth.apiRequest(`/wordwall/live/${encodeURIComponent(wordwallLiveState.code)}/state`);
      const data = payload.data || {};

      if (data.status === 'live') {
        stopWordwallPolling();
        clearPersistedWordwallCode();
        const pin = data.setPin;
        if (!pin) {
          setStatus('Wordwall PIN topilmadi. Admin bilan tekshiring.');
          return;
        }

        const player = encodeURIComponent(String(wordwallLiveState.playerName || user.name || user.email || '').trim());
        window.location.href = `wordwall-play.html?pin=${encodeURIComponent(pin)}&autoplay=1&player=${player}`;
        return;
      }

      if (data.status === 'finished') {
        stopWordwallPolling();
        clearPersistedWordwallCode();
        setStatus('Wordwall live sessiyasi yakunlangan. Yangi kod oling.');
        return;
      }

      setStatus("Wordwall so'rovi qabul qilindi. Admin Start bosishini kuting...");
    } catch (error) {
      if (showError) {
        setStatus(error.message || 'Wordwall live holatini olishda xatolik.');
      }
      if (error.code === 'NOT_FOUND' || error.code === 'NOT_JOINED') {
        clearPersistedWordwallCode();
      }
    }
  };

  const startWordwallPolling = () => {
    stopWordwallPolling();
    wordwallLiveState.pollTimer = setInterval(() => {
      loadWordwallLiveState(false);
    }, 1500);
  };

  const clearQuizResultView = () => {
    stopPolling();
    clearPersistedCode();
    liveState.code = null;
    liveState.currentQuestionId = null;
    liveState.selectedOptionId = null;
    liveState.completionModalShown = false;
    hideQuizCompletionModal();
    setPanelVisible(false);
    setMode('waiting');

    if (ui.feedback) {
      ui.feedback.textContent = '';
    }
    renderLeaderboard([]);
  };

  const deleteOneResult = async () => {
    if (liveState.resultDeleteSubmitting) {
      return;
    }

    liveState.resultDeleteSubmitting = true;
    setResultDeleteBusy(true, "O'chirilmoqda...");

    try {
      const quizCode = sanitizeCode(liveState.code || ui.codeInput?.value || '');
      if (/^\d{5}$/.test(quizCode)) {
        const quizPayload = await window.eduAuth.apiRequest(
          `/quiz/live/${encodeURIComponent(quizCode)}/my-attempt`,
          {
            method: 'DELETE',
          }
        );

        clearQuizResultView();
        setStatus(quizPayload.message || 'Quiz natijasi bitta o\'chirildi.');
        return;
      }

      const wordwallCode = sanitizeCode(wordwallLiveState.code || ui.wordwallCodeInput?.value || '');
      const wordwallName = String(
        wordwallLiveState.playerName || ui.wordwallNameInput?.value || user.name || user.email || ''
      )
        .trim()
        .replace(/\s+/g, ' ');

      if (/^\d{5}$/.test(wordwallCode) && wordwallName) {
        const wordwallPayload = await window.eduAuth.apiRequest(
          `/wordwall/live/${encodeURIComponent(wordwallCode)}/my-attempt`,
          {
            method: 'DELETE',
            body: {
              playerName: wordwallName,
            },
          }
        );

        const remaining = Number(wordwallPayload.data?.remainingAttempts || 0);
        setStatus(
          wordwallPayload.message
            || (remaining > 0
              ? `Wordwall natijasi o'chirildi. Qolgan: ${remaining}`
              : 'Wordwall natijasi bitta o\'chirildi.')
        );
        return;
      }

      setStatus('O\'chirish uchun quiz yoki wordwall natijasi topilmadi.');
    } catch (error) {
      setStatus(error.message || 'Natijani o\'chirib bo\'lmadi.');
    } finally {
      liveState.resultDeleteSubmitting = false;
      setResultDeleteBusy(false);
    }
  };

  const joinWordwallLive = async () => {
    const code = sanitizeCode(ui.wordwallCodeInput?.value || '');
    const playerName = String(ui.wordwallNameInput?.value || '').trim().replace(/\s+/g, ' ');
    if (ui.wordwallCodeInput) {
      ui.wordwallCodeInput.value = code;
    }

    if (!playerName) {
      setStatus('Wordwall uchun avval ismingizni kiriting.');
      return;
    }

    if (!/^\d{5}$/.test(code)) {
      setStatus('Wordwall uchun 5 xonali kod kiriting.');
      return;
    }

    try {
      const payload = await window.eduAuth.apiRequest('/wordwall/live/join', {
        method: 'POST',
        body: { code, playerName },
      });

      wordwallLiveState.code = payload.data?.code || code;
      wordwallLiveState.playerName = playerName;
      persistWordwallCode(wordwallLiveState.code);
      setStatus(payload.message || "Wordwall so'rovi qabul qilindi. Admin Start bosishini kuting...");

      await loadWordwallLiveState(false);
      startWordwallPolling();
    } catch (error) {
      setStatus(error.message || 'Wordwall sessiyasiga qoshilib bolmadi.');
    }
  };

  const joinLiveQuiz = async () => {
    const code = sanitizeCode(ui.codeInput?.value || '');
    if (ui.codeInput) {
      ui.codeInput.value = code;
    }

    if (!/^\d{5}$/.test(code)) {
      setStatus('Quiz uchun 5 xonali kod kiriting.');
      return;
    }

    try {
      const payload = await window.eduAuth.apiRequest('/quiz/live/join', {
        method: 'POST',
        body: { code },
      });

      const data = payload.data || {};
      liveState.code = data.code || code;
      liveState.currentQuestionId = null;
      liveState.selectedOptionId = null;
      liveState.completionModalShown = false;
      hideQuizCompletionModal();

      persistCode(liveState.code);
      setPanelVisible(true);
      renderWaiting();
      setStatus(
        payload.message ||
          "Hotirjam bo'ling, sizning so'rovingiz qabul qilindi. Tez orada quiz testlar boshlanadi."
      );

      await loadLiveState(false);
      startPolling();
    } catch (error) {
      setStatus(error.message || 'Sessiyaga qoshilib bolmadi.');
    }
  };

  document.getElementById('student-logout').addEventListener('click', () => {
    stopPolling();
    stopWordwallPolling();
    clearPersistedCode();
    clearPersistedWordwallCode();
    hideQuizCompletionModal();
    logout();
  });

  if (ui.quizCompletionCloseBtn) {
    ui.quizCompletionCloseBtn.addEventListener('click', hideQuizCompletionModal);
  }

  if (ui.quizCompletionOkBtn) {
    ui.quizCompletionOkBtn.addEventListener('click', hideQuizCompletionModal);
  }

  if (ui.quizCompletionModal) {
    ui.quizCompletionModal.addEventListener('click', (event) => {
      if (event.target === ui.quizCompletionModal) {
        hideQuizCompletionModal();
      }
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && ui.quizCompletionModal && !ui.quizCompletionModal.classList.contains('student-hidden')) {
      hideQuizCompletionModal();
    }
  });

  if (ui.joinBtn) {
    ui.joinBtn.addEventListener('click', joinLiveQuiz);
  }

  if (ui.codeInput) {
    ui.codeInput.addEventListener('input', () => {
      ui.codeInput.value = sanitizeCode(ui.codeInput.value);
    });
    ui.codeInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        joinLiveQuiz();
      }
    });
  }

  if (ui.wordwallJoinBtn) {
    ui.wordwallJoinBtn.addEventListener('click', joinWordwallLive);
  }

  if (ui.wordwallCodeInput) {
    ui.wordwallCodeInput.addEventListener('input', () => {
      ui.wordwallCodeInput.value = sanitizeCode(ui.wordwallCodeInput.value);
    });
    ui.wordwallCodeInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        joinWordwallLive();
      }
    });
  }

  if (ui.options) {
    ui.options.addEventListener('click', (event) => {
      const button = event.target.closest('[data-option-id]');
      if (!button) {
        return;
      }

      const optionId = button.dataset.optionId;
      if (optionId) {
        submitAnswer(optionId);
      }
    });
  }

  if (ui.nextBtn) {
    ui.nextBtn.addEventListener('click', goNextQuestion);
  }

  if (ui.clearResultBtn) {
    ui.clearResultBtn.addEventListener('click', deleteOneResult);
  }

  document.getElementById('open-kahoot').addEventListener('click', () => {
    const pin = document.getElementById('student-kahoot-pin').value.trim();
    if (!pin) {
      setStatus('Kahoot PIN ni kiriting.');
      return;
    }

    window.location.href = `kahoot-play.html?pin=${encodeURIComponent(pin)}`;
  });

  const savedCode = sanitizeCode(localStorage.getItem(LIVE_CODE_STORAGE_KEY) || '');
  const savedWordwallCode = sanitizeCode(localStorage.getItem(WORDWALL_LIVE_CODE_STORAGE_KEY) || '');
  if (/^\d{5}$/.test(savedWordwallCode)) {
    wordwallLiveState.code = savedWordwallCode;
    if (ui.wordwallCodeInput) {
      ui.wordwallCodeInput.value = savedWordwallCode;
    }
    await loadWordwallLiveState(false);
    startWordwallPolling();
  }

  if (/^\d{5}$/.test(savedCode)) {
    liveState.code = savedCode;
    if (ui.codeInput) {
      ui.codeInput.value = savedCode;
    }
    setPanelVisible(true);
    setStatus('Oldingi live sessiya qayta tiklandi.');
    await loadLiveState(false);
    startPolling();
  } else {
    setStatus("5 xonali quiz yoki wordwall kodini kiriting, so'ng admin start bosishini kuting.");
  }

  window.addEventListener('beforeunload', () => {
    stopPolling();
    stopWordwallPolling();
    hideQuizCompletionModal();
  });

  setResultDeleteBusy(false);
});

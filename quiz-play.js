const API_BASE =
  window.API_BASE_URL ||
  localStorage.getItem('eduskill.apiBase') ||
  'http://localhost:3001/api';

const state = {
  quiz: null,
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
  const box = document.getElementById('quiz-status');
  box.className = `status-box status-${type}`;
  box.textContent = message;
}

function renderQuiz(quiz) {
  const container = document.getElementById('quiz-container');
  const title = document.getElementById('quiz-title');
  const meta = document.getElementById('quiz-meta');
  const list = document.getElementById('quiz-questions');

  title.textContent = quiz.title;
  meta.textContent = `Kurs: ${quiz.course_title || '-'} | Vaqt: ${quiz.time_limit_minutes} daqiqa`;

  list.innerHTML = (quiz.questions || [])
    .map(
      (question, index) => `
        <article class="question-card" data-question-id="${question.id}">
          <p class="question-title">${index + 1}. ${escapeHtml(question.questionText)}</p>
          <div class="option-list">
            ${(question.options || [])
              .map(
                (option) => `
                  <label class="option-item">
                    <input type="radio" name="q-${question.id}" value="${option.id}" />
                    <span>${escapeHtml(option.optionText)}</span>
                  </label>
                `
              )
              .join('')}
          </div>
        </article>
      `
    )
    .join('');

  container.style.display = 'block';
}

async function loadQuiz() {
  const quizId = document.getElementById('quiz-id-input').value.trim();
  if (!quizId) {
    setStatus('Avval quiz ID kiriting.', 'error');
    return;
  }

  try {
    setStatus('Quiz yuklanmoqda...', 'info');
    const payload = await request(`/quiz/${quizId}/public`);
    state.quiz = payload.data;
    renderQuiz(payload.data);
    setStatus('Quiz muvaffaqiyatli yuklandi.', 'success');
  } catch (error) {
    setStatus(error.message || 'Quizni yuklab bo\'lmadi.', 'error');
  }
}

function collectAnswers() {
  if (!state.quiz) {
    return [];
  }

  return (state.quiz.questions || [])
    .map((question) => {
      const selected = document.querySelector(`input[name="q-${question.id}"]:checked`);
      if (!selected) {
        return null;
      }
      return {
        questionId: question.id,
        optionId: selected.value,
      };
    })
    .filter(Boolean);
}

async function submitQuiz() {
  if (!state.quiz) {
    setStatus('Quizni avval yuklang.', 'error');
    return;
  }

  const playerName = document.getElementById('player-name-input').value.trim();
  if (!playerName) {
    setStatus('Ismingizni kiriting.', 'error');
    return;
  }

  const answers = collectAnswers();
  if (answers.length === 0) {
    setStatus('Kamida bitta javob tanlang.', 'error');
    return;
  }

  try {
    setStatus('Javoblar yuborilmoqda...', 'info');
    const payload = await request(`/quiz/${state.quiz.id}/attempt`, {
      method: 'POST',
      body: {
        playerName,
        answers,
      },
    });

    const result = payload.data;
    setStatus(
      `Natija: ${result.score}/${result.total_points} ball. Togri javoblar: ${result.correct_answers}.`,
      'success'
    );
  } catch (error) {
    setStatus(error.message || 'Javob yuborilmadi.', 'error');
  }
}

document.getElementById('load-quiz-btn').addEventListener('click', loadQuiz);
document.getElementById('submit-quiz-btn').addEventListener('click', submitQuiz);

const params = new URLSearchParams(window.location.search);
const quizId = params.get('quizId');
if (quizId) {
  document.getElementById('quiz-id-input').value = quizId;
  loadQuiz();
}

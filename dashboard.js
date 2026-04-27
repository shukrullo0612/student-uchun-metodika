const state = {
  courses: [],
  students: [],
  assignments: [],
  quizzes: [],
  kahootSessions: [],
  wordwallSets: [],
  currentKahootSessionId: null,
  currentWordwallSetId: null,
  currentWordwallLiveSessionId: null,
  wordwallLiveMonitorTimer: null,
  currentWordwallTemplate: 'anagram',
  wordwallStage: 'template',
  activeSection: 'home',
  kahootPollTimer: null,
  wordwallComposerReady: false,
};

const DASHBOARD_SECTIONS = new Set([
  'home',
  'courses',
  'students',
  'assignments',
  'quiz',
  'kahoot',
  'wordwall',
  'reports',
  'settings',
]);

function getSectionFromUrlHash() {
  const hashValue = String(window.location.hash || '').replace('#', '').trim().toLowerCase();
  return DASHBOARD_SECTIONS.has(hashValue) ? hashValue : 'home';
}

function setActiveNavigation(sectionId) {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach((item) => {
    item.classList.toggle('active', item.dataset.section === sectionId);
  });
}

function initializeDashboardHistory() {
  const initialSection = getSectionFromUrlHash();
  showSection(initialSection, { updateHistory: false });
  setActiveNavigation(initialSection);

  history.replaceState({ dashboardSection: initialSection }, '', `#${initialSection}`);

  window.addEventListener('popstate', (event) => {
    const stateSection = event.state?.dashboardSection;
    const targetSection = DASHBOARD_SECTIONS.has(stateSection) ? stateSection : getSectionFromUrlHash();
    showSection(targetSection, { updateHistory: false });
    setActiveNavigation(targetSection);
  });
}

function formatRoleLabel(role) {
  const normalized = String(role || '').trim().toLowerCase();
  if (!normalized) {
    return 'user';
  }
  return normalized;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let globalLoadingCounter = 0;

function setGlobalLoading(isLoading, message = 'Yuklanmoqda...') {
  const loader = document.getElementById('global-loader');
  const text = document.getElementById('global-loader-text');

  if (!loader) {
    return;
  }

  if (isLoading) {
    globalLoadingCounter += 1;
    if (text) {
      text.textContent = message;
    }
    loader.classList.remove('hidden');
    document.body.classList.add('is-loading');
    return;
  }

  globalLoadingCounter = Math.max(0, globalLoadingCounter - 1);
  if (globalLoadingCounter === 0) {
    loader.classList.add('hidden');
    document.body.classList.remove('is-loading');
  }
}

async function withGlobalLoading(task, message) {
  setGlobalLoading(true, message);
  try {
    return await task();
  } finally {
    setGlobalLoading(false);
  }
}

function setButtonBusy(button, busy, busyText = 'Yuklanmoqda...') {
  if (!button) {
    return;
  }

  if (busy) {
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent;
    }
    button.classList.add('is-busy');
    button.disabled = true;
    button.textContent = busyText;
    return;
  }

  button.classList.remove('is-busy');
  button.disabled = false;
  if (button.dataset.originalText) {
    button.textContent = button.dataset.originalText;
    delete button.dataset.originalText;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  setGlobalLoading(true, 'Sessiya tekshirilmoqda...');

  const user = await checkAuth('admin');
  if (!user) {
    setGlobalLoading(false);
    return;
  }

  const roleEl = document.getElementById('user-role');
  const emailEl = document.getElementById('user-email');
  if (roleEl) {
    roleEl.textContent = formatRoleLabel(user.role);
  }
  if (emailEl) {
    emailEl.textContent = user.email;
  }
  const profileNameInput = document.querySelector('#settings input[type="text"]');
  const profileEmailInput = document.querySelector('#settings input[type="email"]');
  if (profileNameInput && user.name) {
    profileNameInput.value = user.name;
  }
  if (profileEmailInput) {
    profileEmailInput.value = user.email;
  }

  bindSectionNavigation();
  initializeDashboardHistory();
  bindActionButtons();
  bindRowActions();
  initializeWordwallComposer();

  try {
    await withGlobalLoading(() => refreshAllData(), 'Ma\'lumotlar yuklanmoqda...');
  } catch (error) {
    alert('Backendga ulanib bolmadi. Avval API serverni ishga tushiring.');
  } finally {
    setGlobalLoading(false);
  }

  startKahootPolling();

  document.querySelector('.logout-btn').addEventListener('click', logout);
});

window.addEventListener('beforeunload', () => {
  if (state.kahootPollTimer) {
    clearInterval(state.kahootPollTimer);
    state.kahootPollTimer = null;
  }

  if (state.wordwallLiveMonitorTimer) {
    clearInterval(state.wordwallLiveMonitorTimer);
    state.wordwallLiveMonitorTimer = null;
  }
});

function bindSectionNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const section = item.dataset.section;
      showSection(section, { updateHistory: true });
      setActiveNavigation(section);
    });
  });

  const navCards = document.querySelectorAll('[data-section]');
  navCards.forEach((card) => {
    if (!card.classList.contains('nav-item')) {
      card.addEventListener('click', () => {
        const section = card.dataset.section;
        showSection(section, { updateHistory: true });
        setActiveNavigation(section);
      });
    }
  });
}

function bindRowActions() {
  document.addEventListener('click', async (event) => {
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) {
      return;
    }

    const { action, id } = actionButton.dataset;
    if (!action) {
      return;
    }

    if (!id) {
      return;
    }

    setButtonBusy(actionButton, true, 'Bajarilmoqda...');

    try {
      if (action === 'delete-course') {
        await window.eduAuth.apiRequest(`/courses/${id}`, { method: 'DELETE' });
        await refreshCoursesAndSummary();
      }

      if (action === 'delete-student') {
        await window.eduAuth.apiRequest(`/students/${id}`, { method: 'DELETE' });
        await refreshStudentsAndSummary();
      }

      if (action === 'delete-assignment') {
        await window.eduAuth.apiRequest(`/assignments/${id}`, { method: 'DELETE' });
        await refreshAssignmentsAndSummary();
      }

      if (action === 'view-quiz-attempts') {
        const payload = await window.eduAuth.apiRequest(`/quiz/${id}/attempts`);
        const rows = payload.data || [];
        if (rows.length === 0) {
          alert('Bu quiz uchun hali topshirishlar mavjud emas.');
        } else {
          const top = rows
            .slice(0, 10)
            .map((item, index) => `${index + 1}. ${item.player_name} - ${item.score}/${item.total_points}`)
            .join('\n');
          alert(`So'nggi natijalar:\n${top}`);
        }
      }

      if (action === 'open-quiz-folder') {
        openQuizFolder(id);
        return;
      }

      if (action === 'rename-quiz-folder') {
        await renameQuizFolder(id);
      }

      if (action === 'delete-quiz-folder') {
        await deleteQuizFolder(id);
      }

      if (action === 'settings-quiz-folder') {
        await updateQuizFolderSettings(id);
      }

      if (action === 'host-quiz-folder') {
        await hostQuizFolder(id);
      }

      if (action === 'use-kahoot-session') {
        state.currentKahootSessionId = id;
        await Promise.all([loadKahootMonitor(), loadKahootCurrentQuestion(), loadKahootLeaderboard()]);
      }

      if (action === 'start-kahoot-session') {
        await window.eduAuth.apiRequest(`/kahoot/sessions/${id}/start`, { method: 'POST' });
        state.currentKahootSessionId = id;
        await loadKahootSessions();
        await Promise.all([loadKahootMonitor(), loadKahootCurrentQuestion(), loadKahootLeaderboard()]);
      }

      if (action === 'next-kahoot-question') {
        await window.eduAuth.apiRequest(`/kahoot/sessions/${id}/next-question`, { method: 'POST' });
        state.currentKahootSessionId = id;
        await Promise.all([loadKahootMonitor(), loadKahootCurrentQuestion(), loadKahootLeaderboard()]);
      }

      if (action === 'finish-kahoot-session') {
        await window.eduAuth.apiRequest(`/kahoot/sessions/${id}/finish`, { method: 'POST' });
        await loadKahootSessions();
        await Promise.all([loadKahootMonitor(), loadKahootCurrentQuestion(), loadKahootLeaderboard()]);
      }

      if (action === 'view-kahoot-leaderboard') {
        state.currentKahootSessionId = id;
        await Promise.all([loadKahootMonitor(), loadKahootLeaderboard()]);
      }

      if (action === 'copy-public-link') {
        const link = actionButton.dataset.link;
        if (!link) {
          return;
        }
        const absolute = buildPublicUrl(link);
        await copyToClipboard(absolute);
        alert(`Havola nusxalandi:\n${absolute}`);
      }

      if (action === 'view-wordwall-attempts') {
        const payload = await window.eduAuth.apiRequest(`/wordwall/sets/${id}/attempts`);
        const rows = payload.data || [];
        if (rows.length === 0) {
          alert('Bu set uchun hali urinishlar mavjud emas.');
        } else {
          const top = rows
            .slice(0, 10)
            .map((item, index) => `${index + 1}. ${item.player_name} - ${item.score}%`)
            .join('\n');
          alert(`So'nggi urinishlar:\n${top}`);
        }
      }

      if (action === 'delete-wordwall-set') {
        await window.eduAuth.apiRequest(`/wordwall/sets/${id}`, { method: 'DELETE' });
        if (state.currentWordwallSetId === id) {
          state.currentWordwallSetId = null;
        }
        await loadWordwallSets();
      }

      if (action === 'assign-wordwall-live-link') {
        await assignWordwallLiveLink(id);
      }

      if (action === 'start-wordwall-live-session') {
        await window.eduAuth.apiRequest(`/wordwall/live/sessions/${id}/start`, { method: 'POST' });
        const owningSet = state.wordwallSets.find((set) => set.live_session_id === id);
        if (owningSet) {
          state.currentWordwallSetId = owningSet.id;
        }
        state.currentWordwallLiveSessionId = id;
        await loadWordwallSets();
        await loadWordwallLiveMonitor(id);
      }

      if (action === 'restart-wordwall-live-code') {
        await window.eduAuth.apiRequest(`/wordwall/live/sessions/${id}/restart-code`, { method: 'POST' });
        const owningSet = state.wordwallSets.find((set) => set.live_session_id === id);
        if (owningSet) {
          state.currentWordwallSetId = owningSet.id;
        }
        state.currentWordwallLiveSessionId = id;
        await loadWordwallSets();
        await loadWordwallLiveMonitor(id);
      }

      if (action === 'finish-wordwall-live-session') {
        await window.eduAuth.apiRequest(`/wordwall/live/sessions/${id}/finish`, { method: 'POST' });
        const owningSet = state.wordwallSets.find((set) => set.live_session_id === id);
        if (owningSet) {
          state.currentWordwallSetId = owningSet.id;
        }
        state.currentWordwallLiveSessionId = id;
        await loadWordwallSets();
        await loadWordwallLiveMonitor(id);
      }

      if (action === 'monitor-wordwall-live') {
        const owningSet = state.wordwallSets.find((set) => set.live_session_id === id);
        if (owningSet) {
          state.currentWordwallSetId = owningSet.id;
        }
        state.currentWordwallLiveSessionId = id;
        renderWordwallLiveControls();
        await loadWordwallLiveMonitor(id);
      }
    } catch (error) {
      alert(error.message || 'Amal bajarilmadi');
    } finally {
      setButtonBusy(actionButton, false);
    }
  });
}

function bindActionButtons() {
  document.getElementById('create-course-btn').addEventListener('click', createCourse);
  document.getElementById('create-student-btn').addEventListener('click', createStudent);
  document
    .getElementById('create-assignment-btn')
    .addEventListener('click', createAssignment);

  const saveQuizButton = document.getElementById('save-quiz-btn');
  if (saveQuizButton) {
    saveQuizButton.addEventListener('click', saveQuiz);
  }

  document
    .getElementById('create-quiz-quick-btn')
    .addEventListener('click', createQuizFolderQuick);
  document
    .getElementById('create-kahoot-session-btn')
    .addEventListener('click', createKahootSession);
  document
    .getElementById('save-kahoot-question-btn')
    .addEventListener('click', saveKahootQuestion);

  const createWordwallButton = document.getElementById('create-wordwall-set-btn');
  if (createWordwallButton) {
    createWordwallButton.addEventListener('click', createWordwallSet);
  }

  const addWordwallItemButton = document.getElementById('add-wordwall-item-btn');
  if (addWordwallItemButton) {
    addWordwallItemButton.addEventListener('click', addWordwallItem);
  }

  const wordwallAssignTopButton = document.getElementById('wordwall-live-assign-top-btn');
  if (wordwallAssignTopButton) {
    wordwallAssignTopButton.addEventListener('click', async () => {
      const selectedSet = getCurrentWordwallSet();
      if (!selectedSet) {
        alert('Avval Wordwall set yarating yoki tanlang.');
        return;
      }

      setButtonBusy(wordwallAssignTopButton, true, 'Tayyorlanmoqda...');
      try {
        await assignWordwallLiveLink(selectedSet.id);
      } catch (error) {
        alert(error.message || 'Assign link tayyorlab bolmadi.');
      } finally {
        setButtonBusy(wordwallAssignTopButton, false);
        renderWordwallLiveControls();
      }
    });
  }

  const wordwallStartTopButton = document.getElementById('wordwall-live-start-top-btn');
  if (wordwallStartTopButton) {
    wordwallStartTopButton.addEventListener('click', async () => {
      const selectedSet = getCurrentWordwallSet();
      if (!selectedSet?.live_session_id) {
        alert('Avval Assign Link tugmasini bosing.');
        return;
      }

      setButtonBusy(wordwallStartTopButton, true, 'Start...');
      try {
        await window.eduAuth.apiRequest(`/wordwall/live/sessions/${selectedSet.live_session_id}/start`, {
          method: 'POST',
        });

        state.wordwallSets = state.wordwallSets.map((set) =>
          set.id === selectedSet.id
            ? {
                ...set,
                live_status: 'live',
              }
            : set
        );

        state.currentWordwallSetId = selectedSet.id;
        state.currentWordwallLiveSessionId = selectedSet.live_session_id;
        await loadWordwallSets();
      } catch (error) {
        alert(error.message || 'Live sessiyani start qilib bolmadi.');
      } finally {
        setButtonBusy(wordwallStartTopButton, false);
        renderWordwallLiveControls();
      }
    });
  }

  const wordwallRestartTopButton = document.getElementById('wordwall-live-restart-top-btn');
  if (wordwallRestartTopButton) {
    wordwallRestartTopButton.addEventListener('click', async () => {
      const selectedSet = getCurrentWordwallSet();
      if (!selectedSet?.live_session_id) {
        alert('Avval Assign Link tugmasini bosing.');
        return;
      }

      setButtonBusy(wordwallRestartTopButton, true, 'Yangilanmoqda...');
      try {
        const payload = await window.eduAuth.apiRequest(`/wordwall/live/sessions/${selectedSet.live_session_id}/restart-code`, {
          method: 'POST',
        });

        state.wordwallSets = state.wordwallSets.map((set) =>
          set.id === selectedSet.id
            ? {
                ...set,
                live_code: payload.data?.code || set.pin || set.live_code,
                live_status: payload.data?.status || 'waiting',
              }
            : set
        );

        state.currentWordwallSetId = selectedSet.id;
        state.currentWordwallLiveSessionId = selectedSet.live_session_id;
        await loadWordwallSets();
      } catch (error) {
        alert(error.message || 'Live kodni yangilab bolmadi.');
      } finally {
        setButtonBusy(wordwallRestartTopButton, false);
        renderWordwallLiveControls();
      }
    });
  }

  const wordwallFinishTopButton = document.getElementById('wordwall-live-finish-top-btn');
  if (wordwallFinishTopButton) {
    wordwallFinishTopButton.addEventListener('click', async () => {
      const selectedSet = getCurrentWordwallSet();
      if (!selectedSet?.live_session_id) {
        alert('Tugatish uchun aktiv sessiya topilmadi.');
        return;
      }

      setButtonBusy(wordwallFinishTopButton, true, 'Yakunlanmoqda...');
      try {
        await window.eduAuth.apiRequest(`/wordwall/live/sessions/${selectedSet.live_session_id}/finish`, {
          method: 'POST',
        });

        state.wordwallSets = state.wordwallSets.map((set) =>
          set.id === selectedSet.id
            ? {
                ...set,
                live_status: 'finished',
              }
            : set
        );

        state.currentWordwallSetId = selectedSet.id;
        state.currentWordwallLiveSessionId = selectedSet.live_session_id;
        await loadWordwallSets();
      } catch (error) {
        alert(error.message || 'Sessiyani yakunlab bolmadi.');
      } finally {
        setButtonBusy(wordwallFinishTopButton, false);
        renderWordwallLiveControls();
      }
    });
  }
}

async function createQuizFolderQuick() {
  const title = prompt('Quiz papka nomini kiriting:');
  if (!title) {
    return;
  }

  const timeRaw = prompt('Muddati (daqiqada):', '15') || '15';
  const timeLimitMinutes = Number.parseInt(timeRaw.replace(/[^0-9]/g, ''), 10) || 15;

  try {
    await withGlobalLoading(
      () =>
        window.eduAuth.apiRequest('/quiz', {
          method: 'POST',
          body: {
            title,
            courseId: null,
            timeLimitMinutes,
          },
        }),
      'Papka yaratilmoqda...'
    );

    await Promise.all([loadQuizzes(), loadReports()]);
  } catch (error) {
    alert(error.message || 'Papka yaratilmadi');
  }
}

async function refreshAllData() {
  await Promise.all([
    loadCourses(),
    loadStudents(),
    loadAssignments(),
    loadReports(),
    loadQuizzes(),
    loadKahootSessions(),
    loadWordwallSets(),
  ]);
}

async function refreshCoursesAndSummary() {
  await Promise.all([loadCourses(), loadReports(), loadQuizzes()]);
}

async function refreshStudentsAndSummary() {
  await Promise.all([loadStudents(), loadReports()]);
}

async function refreshAssignmentsAndSummary() {
  await Promise.all([loadAssignments(), loadReports()]);
}

function startKahootPolling() {
  if (state.kahootPollTimer) {
    clearInterval(state.kahootPollTimer);
  }

  state.kahootPollTimer = setInterval(async () => {
    const kahootSection = document.getElementById('kahoot');
    if (!kahootSection || !kahootSection.classList.contains('active')) {
      return;
    }

    if (!state.currentKahootSessionId) {
      return;
    }

    try {
      await Promise.all([loadKahootMonitor(), loadKahootCurrentQuestion(), loadKahootLeaderboard()]);
    } catch (error) {
      // Silent polling failure to avoid intrusive alerts.
    }
  }, 4000);
}

function buildPublicUrl(relativePath) {
  return new URL(relativePath, window.location.href).href;
}

async function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

async function loadCourses() {
  const payload = await window.eduAuth.apiRequest('/courses');
  state.courses = payload.data || [];

  const body = document.getElementById('courses-body');
  if (!body) {
    return;
  }

  if (state.courses.length === 0) {
    body.innerHTML = `<tr><td colspan="4">Hali kurslar mavjud emas</td></tr>`;
  } else {
    body.innerHTML = state.courses
      .map(
        (course) => `
          <tr>
            <td>${course.title}</td>
            <td>-</td>
            <td><span class="badge ${String(course.status || '').toLowerCase().includes('faol') ? 'active' : ''}">${course.status || 'Faol'}</span></td>
            <td>
              <button class="table-action-btn" data-action="delete-course" data-id="${course.id}">Ochirish</button>
            </td>
          </tr>
        `
      )
      .join('');
  }

  fillCourseSelect();
}

async function loadStudents() {
  const payload = await window.eduAuth.apiRequest('/students');
  state.students = payload.data || [];

  const body = document.getElementById('students-body');
  if (!body) {
    return;
  }

  if (state.students.length === 0) {
    body.innerHTML = `<tr><td colspan="5">Hali oquvchilar mavjud emas</td></tr>`;
  } else {
    body.innerHTML = state.students
      .map(
        (student) => `
          <tr>
            <td>${student.full_name}</td>
            <td>${student.email}</td>
            <td>${student.group_name}</td>
            <td>${new Date(student.created_at).toISOString().slice(0, 10)}</td>
            <td>
              <button class="table-action-btn" data-action="delete-student" data-id="${student.id}">Ochirish</button>
            </td>
          </tr>
        `
      )
      .join('');
  }
}

async function loadAssignments() {
  const payload = await window.eduAuth.apiRequest('/assignments');
  state.assignments = payload.data || [];

  const body = document.getElementById('assignments-body');
  if (!body) {
    return;
  }

  if (state.assignments.length === 0) {
    body.innerHTML = `<tr><td colspan="5">Hali topshiriqlar mavjud emas</td></tr>`;
  } else {
    body.innerHTML = state.assignments
      .map(
        (assignment) => `
          <tr>
            <td>${assignment.title}</td>
            <td>${assignment.course_title || '-'}</td>
            <td>${assignment.completed_tasks}</td>
            <td>${assignment.total_tasks}</td>
            <td>
              <button class="table-action-btn" data-action="delete-assignment" data-id="${assignment.id}">Ochirish</button>
            </td>
          </tr>
        `
      )
      .join('');
  }
}

async function loadReports() {
  const payload = await window.eduAuth.apiRequest('/reports/summary');
  const summary = payload.data || {
    students: 0,
    courses: 0,
    completedAssignments: 0,
    averageScore: 0,
  };

  const statCards = document.querySelectorAll('#home .stat-card h3');
  if (statCards.length >= 4) {
    statCards[0].textContent = summary.students;
    statCards[1].textContent = summary.courses;
    statCards[2].textContent = summary.completedAssignments;
    statCards[3].textContent = `${Math.round(summary.averageScore)}%`;
  }

  const metrics = document.querySelectorAll('#reports .metric strong');
  if (metrics.length >= 3) {
    metrics[0].textContent = `${Math.round(summary.averageScore)}%`;
    metrics[1].textContent = `${summary.completedAssignments}`;
    metrics[2].textContent = `${(summary.courses * 2.1 + 1).toFixed(1)} soat`;
  }
}

async function loadQuizzes() {
  const payload = await window.eduAuth.apiRequest('/quiz');
  state.quizzes = payload.data || [];

  const list = document.getElementById('quiz-list');
  if (!list) {
    return;
  }

  if (state.quizzes.length === 0) {
    list.innerHTML = '<div class="entity-list-item"><span>Hali quiz yaratilmagan</span></div>';
    return;
  }

  list.innerHTML = `<div class="quiz-folder-grid">${state.quizzes
    .map((quiz, index) => {
      const coverClass = `quiz-cover-${(index % 4) + 1}`;
      const createdDate = new Date(quiz.created_at).toISOString().slice(0, 10);
      return `
        <article class="quiz-folder-card pro-card">
          <div class="quiz-folder-thumb ${coverClass}">
            <div class="quiz-folder-count">${quiz.question_count} savol</div>
          </div>
          <div class="quiz-folder-body">
            <h4 class="quiz-folder-title">${escapeHtml(quiz.title)}</h4>
            <div class="quiz-folder-meta">${Number(quiz.plays_count || 0)} marta ishlangan</div>
            <div class="quiz-folder-meta">Yaratilgan: ${createdDate}</div>

            <div class="quiz-folder-tools">
              <button class="quiz-icon-btn" title="Papka nomini tahrirlash" data-action="rename-quiz-folder" data-id="${quiz.id}">✎</button>
              <button class="quiz-icon-btn" title="Papkani ochirish" data-action="delete-quiz-folder" data-id="${quiz.id}">🗑</button>
              <button class="quiz-icon-btn" title="Papka sozlamalari" data-action="settings-quiz-folder" data-id="${quiz.id}">⚙</button>
            </div>

            <div class="quiz-folder-bottom">
              <button class="quiz-link-btn" data-action="open-quiz-folder" data-id="${quiz.id}">Assign</button>
              <button class="quiz-host-btn" data-action="host-quiz-folder" data-id="${quiz.id}">▶ Host</button>
            </div>

            <div class="quiz-folder-links">
              <button class="table-action-btn" data-action="copy-public-link" data-id="${quiz.id}" data-link="quiz-play.html?quizId=${quiz.id}">Link nusxa</button>
              <button class="table-action-btn" data-action="view-quiz-attempts" data-id="${quiz.id}">Natijalar</button>
              <span class="badge ${quiz.is_published ? 'active' : ''}">${quiz.is_published ? 'Faol' : 'Draft'}</span>
            </div>
          </div>
        </article>
      `;
    })
    .join('')}</div>`;
}

function resetQuizFolderForm() {
  const section = document.getElementById('quiz');
  if (!section) {
    return;
  }

  const titleInput = section.querySelector('.form-grid input[placeholder="Mustaqil ishlash testi"]');
  const timeInput = section.querySelector('.form-grid input[placeholder="15 daqiqa"]');
  if (titleInput) {
    titleInput.value = '';
  }
  if (timeInput) {
    timeInput.value = '15 daqiqa';
  }
}

function getQuizFolderById(quizId) {
  return state.quizzes.find((quiz) => quiz.id === quizId) || null;
}

async function renameQuizFolder(quizId) {
  const quiz = getQuizFolderById(quizId);
  const nextTitle = prompt('Papka yangi nomi:', quiz?.title || '');
  if (!nextTitle || !nextTitle.trim()) {
    return;
  }

  try {
    await withGlobalLoading(
      () =>
        window.eduAuth.apiRequest(`/quiz/${quizId}`, {
          method: 'PATCH',
          body: { title: nextTitle.trim() },
        }),
      'Papka nomi yangilanmoqda...'
    );

    await loadQuizzes();
  } catch (error) {
    alert(error.message || 'Papka nomini yangilab bolmadi');
  }
}

async function deleteQuizFolder(quizId) {
  if (!confirm('Bu papkani butunlay ochirmoqchimisiz? Savollar ham o\'chadi.')) {
    return;
  }

  try {
    await withGlobalLoading(
      () => window.eduAuth.apiRequest(`/quiz/${quizId}`, { method: 'DELETE' }),
      'Papka ochirilmoqda...'
    );

    await Promise.all([loadQuizzes(), loadReports()]);
  } catch (error) {
    alert(error.message || 'Papkani ochirib bolmadi');
  }
}

async function updateQuizFolderSettings(quizId) {
  const quiz = getQuizFolderById(quizId);
  if (!quiz) {
    return;
  }

  const titleInput = prompt('Papka nomi:', quiz.title || '');
  if (!titleInput || !titleInput.trim()) {
    return;
  }

  const timeInput = prompt(
    'Muddat (daqiqada):',
    String(Number.parseInt(String(quiz.time_limit_minutes || 15), 10) || 15)
  );
  if (!timeInput) {
    return;
  }

  const timeLimitMinutes = Number.parseInt(String(timeInput).replace(/[^0-9]/g, ''), 10) || 15;
  const publishNow = confirm('Quizni Faol (publish) holatida qoldiraylikmi?');

  try {
    await withGlobalLoading(
      () =>
        window.eduAuth.apiRequest(`/quiz/${quizId}`, {
          method: 'PATCH',
          body: {
            title: titleInput.trim(),
            timeLimitMinutes,
            isPublished: publishNow,
          },
        }),
      'Papka sozlamalari saqlanmoqda...'
    );

    await loadQuizzes();
  } catch (error) {
    alert(error.message || 'Sozlamalarni saqlab bolmadi');
  }
}

async function hostQuizFolder(quizId) {
  window.location.href = `quiz-editor.html?quizId=${encodeURIComponent(quizId)}&host=1`;
}

function openQuizFolder(quizId) {
  window.location.href = `quiz-editor.html?quizId=${encodeURIComponent(quizId)}`;
}

async function loadKahootSessions() {
  const payload = await window.eduAuth.apiRequest('/kahoot/sessions');
  state.kahootSessions = payload.data || [];

  if (!state.currentKahootSessionId && state.kahootSessions.length > 0) {
    state.currentKahootSessionId = state.kahootSessions[0].id;
  }

  if (
    state.currentKahootSessionId &&
    !state.kahootSessions.some((session) => session.id === state.currentKahootSessionId)
  ) {
    state.currentKahootSessionId = state.kahootSessions[0]?.id || null;
  }

  const list = document.getElementById('kahoot-session-list');
  if (!list) {
    return;
  }

  if (state.kahootSessions.length === 0) {
    list.innerHTML = '<div class="entity-list-item"><span>Hali session yaratilmagan</span></div>';
    const monitor = document.getElementById('kahoot-monitor');
    const currentQuestion = document.getElementById('kahoot-current-question');
    const leaderboard = document.getElementById('kahoot-leaderboard');
    if (monitor) {
      monitor.innerHTML = '';
    }
    if (currentQuestion) {
      currentQuestion.innerHTML = '';
    }
    if (leaderboard) {
      leaderboard.innerHTML = '';
    }
    return;
  }

  list.innerHTML = state.kahootSessions
    .map(
      (session) => `
        <div class="entity-list-item">
          <div>
            <strong>${session.title}</strong>
            <div class="meta">PIN: ${session.pin} | Status: ${session.status}</div>
          </div>
          <div class="entity-actions">
            <button class="table-action-btn" data-action="use-kahoot-session" data-id="${session.id}">Tanlash</button>
            <button class="table-action-btn" data-action="start-kahoot-session" data-id="${session.id}">Start</button>
            <button class="table-action-btn" data-action="next-kahoot-question" data-id="${session.id}">Keyingi savol</button>
            <button class="table-action-btn" data-action="finish-kahoot-session" data-id="${session.id}">Finish</button>
            <button class="table-action-btn" data-action="view-kahoot-leaderboard" data-id="${session.id}">Reyting</button>
            <a class="table-action-btn" href="kahoot-play.html?pin=${session.pin}" target="_blank" rel="noopener">Oquvchi havolasi</a>
            <button class="table-action-btn" data-action="copy-public-link" data-id="${session.id}" data-link="kahoot-play.html?pin=${session.pin}">Nusxa</button>
          </div>
        </div>
      `
    )
    .join('');

  const selectedSession = state.kahootSessions.find((item) => item.id === state.currentKahootSessionId);
  const badge = document.querySelector('#kahoot .pill.danger');
  if (selectedSession && badge) {
    badge.textContent = `PIN ${selectedSession.pin}`;
  }

  await Promise.all([loadKahootMonitor(), loadKahootCurrentQuestion(), loadKahootLeaderboard()]);
}

async function loadKahootMonitor() {
  const box = document.getElementById('kahoot-monitor');
  if (!box) {
    return;
  }

  if (!state.currentKahootSessionId) {
    box.innerHTML = '<div class="entity-list-item"><span>Monitor uchun session tanlang</span></div>';
    return;
  }

  try {
    const payload = await window.eduAuth.apiRequest(`/kahoot/sessions/${state.currentKahootSessionId}/monitor`);
    const data = payload.data || {};
    const session = data.session || {};
    const progress = data.progress || { current: 0, total: 0 };
    const participants = Array.isArray(data.participants) ? data.participants : [];

    const header = `
      <div class="entity-list-item entity-stack">
        <strong>Live monitor</strong>
        <div class="meta">PIN: ${session.pin || '-'} | Holat: ${session.status || 'draft'}</div>
        <div class="meta">Savol: ${Number(progress.current || 0)} / ${Number(progress.total || 0)} | Qolgan vaqt: ${Number(data.remainingSeconds || 0)}s</div>
        <div class="meta">Javoblar: ${Number(data.answerCount || 0)} / ${Number(data.participantCount || 0)}</div>
      </div>
    `;

    if (participants.length === 0) {
      box.innerHTML = `${header}<div class="entity-list-item"><span>Hali ishtirokchi yoq</span></div>`;
      return;
    }

    const rows = participants
      .slice(0, 20)
      .map(
        (item, index) => `
          <div class="entity-list-item">
            <strong>${index + 1}. ${escapeHtml(item.player_name)}</strong>
            <span class="badge active">${Number(item.score || 0)} ball</span>
            <span class="meta">✅ ${Number(item.correct_answers || 0)} | ❌ ${Number(item.incorrect_answers || 0)}</span>
          </div>
        `
      )
      .join('');

    box.innerHTML = `${header}${rows}`;
  } catch (error) {
    box.innerHTML = `<div class="entity-list-item"><span>${error.message || 'Monitorni yuklab bolmadi'}</span></div>`;
  }
}

async function loadKahootCurrentQuestion() {
  const box = document.getElementById('kahoot-current-question');
  if (!box) {
    return;
  }

  if (!state.currentKahootSessionId) {
    box.innerHTML = '<div class="entity-list-item"><span>Session tanlanmagan</span></div>';
    return;
  }

  try {
    const payload = await window.eduAuth.apiRequest(
      `/kahoot/sessions/${state.currentKahootSessionId}/current-question`
    );

    const data = payload.data || {};
    const session = data.session || {};
    const progress = data.progress || { current: 0, total: 0 };
    const question = payload.data?.question;
    if (!question) {
      if (session.status === 'finished') {
        box.innerHTML = '<div class="entity-list-item"><span>Session yakunlangan. Savollar tugagan.</span></div>';
      } else if (session.status === 'draft') {
        box.innerHTML = '<div class="entity-list-item"><span>Session hali boshlanmagan.</span></div>';
      } else {
        box.innerHTML = '<div class="entity-list-item"><span>Hali savol mavjud emas</span></div>';
      }
      return;
    }

    box.innerHTML = `
      <div class="entity-list-item entity-stack">
        <strong>Joriy savol</strong>
        <div class="meta">Holat: ${session.status || 'live'} | Savol: ${Number(progress.current || 0)} / ${Number(progress.total || 0)}</div>
        <div class="meta">Qolgan vaqt: ${Number(data.remainingSeconds || 0)}s | Javoblar: ${Number(data.answerCount || 0)} / ${Number(data.participantCount || 0)}</div>
        <div class="meta">${escapeHtml(question.questionText)}</div>
        <div class="meta">A) ${escapeHtml(question.optionA)} | B) ${escapeHtml(question.optionB)}</div>
        <div class="meta">C) ${escapeHtml(question.optionC)} | D) ${escapeHtml(question.optionD)}</div>
      </div>
    `;
  } catch (error) {
    box.innerHTML = `<div class="entity-list-item"><span>${error.message || 'Joriy savolni yuklab bolmadi'}</span></div>`;
  }
}

async function loadKahootLeaderboard() {
  const box = document.getElementById('kahoot-leaderboard');
  if (!box) {
    return;
  }

  if (!state.currentKahootSessionId) {
    box.innerHTML = '<div class="entity-list-item"><span>Reyting uchun session tanlang</span></div>';
    return;
  }

  try {
    const payload = await window.eduAuth.apiRequest(
      `/kahoot/sessions/${state.currentKahootSessionId}/leaderboard`
    );

    const leaderboard = payload.data || [];
    if (leaderboard.length === 0) {
      box.innerHTML = '<div class="entity-list-item"><span>Hali javoblar mavjud emas</span></div>';
      return;
    }

    box.innerHTML = leaderboard
      .slice(0, 10)
      .map(
        (item, index) => `
          <div class="entity-list-item">
            <strong>${index + 1}. ${item.player_name}</strong>
            <span class="badge active">${item.score} ball</span>
            <span class="meta">✅ ${Number(item.correct_answers || 0)} | ❌ ${Number(item.incorrect_answers || 0)}</span>
          </div>
        `
      )
      .join('');
  } catch (error) {
    box.innerHTML = `<div class="entity-list-item"><span>${error.message || 'Reytingni yuklab bolmadi'}</span></div>`;
  }
}

function getCurrentWordwallSet() {
  if (state.wordwallSets.length === 0) {
    return null;
  }

  return state.wordwallSets.find((set) => set.id === state.currentWordwallSetId) || state.wordwallSets[0];
}

function buildWordwallPublicLinkByPin(pin) {
  return `wordwall-play.html?pin=${encodeURIComponent(String(pin || '').trim())}`;
}

async function assignWordwallLiveLink(setId, { showAlert = true } = {}) {
  const payload = await window.eduAuth.apiRequest(`/wordwall/sets/${setId}/live`, {
    method: 'POST',
  });

  state.currentWordwallSetId = setId;
  state.currentWordwallLiveSessionId = payload.data?.id || null;
  await loadWordwallSets();

  const selectedSet = getCurrentWordwallSet();
  const pin = selectedSet?.pin || payload.data?.code;
  if (!pin) {
    if (showAlert) {
      alert('Kod topilmadi. Qayta urinib ko\'ring.');
    }
    return;
  }

  const absoluteLink = buildPublicUrl(buildWordwallPublicLinkByPin(pin));
  await copyToClipboard(absoluteLink);

  if (showAlert) {
    alert(`Assign link tayyor.\nKod: ${pin}\nHavola nusxalandi:\n${absoluteLink}`);
  }
}

function renderWordwallLiveControls() {
  const titleEl = document.getElementById('wordwall-live-current-title');
  const codeEl = document.getElementById('wordwall-live-current-code');
  const statusEl = document.getElementById('wordwall-live-current-status');
  const assignBtn = document.getElementById('wordwall-live-assign-top-btn');
  const startBtn = document.getElementById('wordwall-live-start-top-btn');
  const restartBtn = document.getElementById('wordwall-live-restart-top-btn');
  const finishBtn = document.getElementById('wordwall-live-finish-top-btn');

  const selectedSet = getCurrentWordwallSet();

  if (!selectedSet) {
    if (titleEl) {
      titleEl.textContent = 'Live sessiya uchun set tanlang';
    }
    if (codeEl) {
      codeEl.textContent = '-----';
    }
    if (statusEl) {
      statusEl.textContent = 'waiting';
    }
    if (assignBtn) {
      assignBtn.disabled = true;
    }
    if (startBtn) {
      startBtn.disabled = true;
    }
    if (restartBtn) {
      restartBtn.disabled = true;
    }
    if (finishBtn) {
      finishBtn.disabled = true;
    }
    return;
  }

  const hasLiveSession = Boolean(selectedSet.live_session_id);
  const liveStatus = selectedSet.live_status || 'none';

  if (titleEl) {
    titleEl.textContent = `${selectedSet.title} (PIN: ${selectedSet.pin || '-'})`;
  }
  if (codeEl) {
    codeEl.textContent = selectedSet.live_code || selectedSet.pin || '-----';
  }
  if (statusEl) {
    statusEl.textContent = liveStatus;
  }
  if (assignBtn) {
    assignBtn.disabled = false;
  }
  if (startBtn) {
    startBtn.disabled = !hasLiveSession || liveStatus !== 'waiting';
  }
  if (restartBtn) {
    restartBtn.disabled = !hasLiveSession;
  }
  if (finishBtn) {
    finishBtn.disabled = !hasLiveSession || liveStatus !== 'live';
  }
}

async function loadWordwallSets() {
  const payload = await window.eduAuth.apiRequest('/wordwall/sets');
  state.wordwallSets = payload.data || [];

  if (!state.currentWordwallSetId && state.wordwallSets.length > 0) {
    state.currentWordwallSetId = state.wordwallSets[0].id;
  }

  if (
    state.currentWordwallSetId &&
    !state.wordwallSets.some((set) => set.id === state.currentWordwallSetId)
  ) {
    state.currentWordwallSetId = state.wordwallSets[0]?.id || null;
  }

  const list = document.getElementById('wordwall-set-list');
  if (!list) {
    return;
  }

  if (state.wordwallSets.length === 0) {
    list.innerHTML = '<div class="entity-list-item"><span>Hali wordwall set yaratilmagan</span></div>';
    renderWordwallLiveControls();
    const monitor = document.getElementById('wordwall-live-monitor');
    if (monitor) {
      monitor.innerHTML = '';
    }
    return;
  }

  list.innerHTML = state.wordwallSets
    .map(
      (set) => {
        const publicLink = set.pin ? `wordwall-play.html?pin=${set.pin}` : `wordwall-play.html?setId=${set.id}`;
        const liveCode = set.live_code || '-----';
        const liveStatus = set.live_status || 'none';
        const hasLiveSession = Boolean(set.live_session_id);
        const isLiveStarted = liveStatus === 'live';
        const canStartLive = liveStatus === 'waiting';

        return `
        <div class="entity-list-item">
          <div>
            <strong>${set.title}</strong>
            <div class="meta">Template: ${set.template_type}</div>
            <div class="meta">Ishora rejimi: ${set.clue_mode === 'with' ? 'Ishoralar bilan' : 'Izohlarsiz'}</div>
            <div class="meta">Kod: ${set.pin || '-'}</div>
            <div class="meta">Live kod: ${liveCode} | Holat: ${liveStatus}</div>
          </div>
          <div class="entity-actions">
            <button class="table-action-btn" data-wordwall-use="${set.id}">Tanlash</button>
            <a class="table-action-btn" href="${publicLink}" target="_blank" rel="noopener">Oquvchi havolasi</a>
            <button class="table-action-btn" data-action="copy-public-link" data-id="${set.id}" data-link="${publicLink}">Nusxa</button>
            <button class="table-action-btn" data-action="view-wordwall-attempts" data-id="${set.id}">Natijalar</button>
            <button class="table-action-btn" data-action="assign-wordwall-live-link" data-id="${set.id}">Assign Link</button>
            <button class="table-action-btn" data-action="start-wordwall-live-session" data-id="${set.live_session_id || ''}" ${hasLiveSession && canStartLive ? '' : 'disabled'}>Start</button>
            <button class="table-action-btn" data-action="restart-wordwall-live-code" data-id="${set.live_session_id || ''}" ${hasLiveSession ? '' : 'disabled'}>Restart code</button>
            <button class="table-action-btn" data-action="finish-wordwall-live-session" data-id="${set.live_session_id || ''}" ${hasLiveSession && isLiveStarted ? '' : 'disabled'}>Finish</button>
            <button class="table-action-btn" data-action="monitor-wordwall-live" data-id="${set.live_session_id || ''}" ${hasLiveSession ? '' : 'disabled'}>Ishtirokchilar</button>
            <button class="table-action-btn" data-action="delete-wordwall-set" data-id="${set.id}">O'chirish</button>
          </div>
        </div>
      `;
      }
    )
    .join('');

  list.querySelectorAll('[data-wordwall-use]').forEach((button) => {
    button.addEventListener('click', async () => {
      state.currentWordwallSetId = button.dataset.wordwallUse;
      const selectedSet = getCurrentWordwallSet();
      state.currentWordwallLiveSessionId = selectedSet?.live_session_id || null;
      renderWordwallLiveControls();
      await loadWordwallLiveMonitor(state.currentWordwallLiveSessionId);
    });
  });

  const selectedSet = getCurrentWordwallSet();
  if (selectedSet?.live_session_id) {
    state.currentWordwallLiveSessionId = selectedSet.live_session_id;
  } else if (!state.currentWordwallLiveSessionId) {
    state.currentWordwallLiveSessionId = state.wordwallSets.find((set) => set.live_session_id)?.live_session_id || null;
  }

  renderWordwallLiveControls();

  await loadWordwallLiveMonitor(state.currentWordwallLiveSessionId);
}

async function loadWordwallLiveMonitor(sessionId) {
  const box = document.getElementById('wordwall-live-monitor');
  if (!box) {
    return;
  }

  if (state.wordwallLiveMonitorTimer) {
    clearInterval(state.wordwallLiveMonitorTimer);
    state.wordwallLiveMonitorTimer = null;
  }

  if (!sessionId) {
    box.innerHTML = '<div class="entity-list-item"><span>Wordwall live monitor uchun avval Assign Link bosing</span></div>';
    return;
  }

  try {
    const payload = await window.eduAuth.apiRequest(`/wordwall/live/sessions/${sessionId}/monitor`);
    const data = payload.data || {};
    const participants = Array.isArray(data.participants) ? data.participants : [];

    const participantsHtml = participants.length
      ? participants
          .map(
            (item, index) => `<div class="entity-list-item"><strong>${index + 1}. ${escapeHtml(item.player_name)}</strong><span class="meta">${new Date(item.joined_at).toLocaleString('uz-UZ')}</span></div>`
          )
          .join('')
      : '<div class="entity-list-item"><span>Hali ishtirokchi yoq</span></div>';

    box.innerHTML = `
      <div class="entity-list-item">
        <div>
          <strong>Wordwall live monitor</strong>
          <div class="meta">Set: ${escapeHtml(data.setTitle || '-')}</div>
          <div class="meta">Kod: ${escapeHtml(data.code || '-----')} | Holat: ${escapeHtml(data.status || 'waiting')} | Ishtirokchilar: ${Number(data.participantsCount || 0)}</div>
        </div>
      </div>
      ${participantsHtml}
    `;

    state.wordwallLiveMonitorTimer = setInterval(() => {
      loadWordwallLiveMonitor(sessionId);
    }, 2000);
  } catch (error) {
    box.innerHTML = `<div class="entity-list-item"><span>${error.message || 'Wordwall live monitor yuklanmadi'}</span></div>`;
  }
}

function fillCourseSelect() {
  const quizSection = document.getElementById('quiz');
  if (!quizSection) {
    return;
  }

  const courseSelect = quizSection.querySelector('.form-grid select');
  if (!courseSelect) {
    return;
  }

  if (state.courses.length === 0) {
    courseSelect.innerHTML = '<option value="">Kurs topilmadi</option>';
    return;
  }

  courseSelect.innerHTML = state.courses
    .map((course) => `<option value="${course.id}">${course.title}</option>`)
    .join('');
}

async function createCourse() {
  const title = prompt('Kurs nomini kiriting:');
  if (!title) {
    return;
  }

  const description = prompt('Kurs tavsifi (ixtiyoriy):') || '';

  try {
    await withGlobalLoading(
      () =>
        window.eduAuth.apiRequest('/courses', {
          method: 'POST',
          body: { title, description, status: 'Faol' },
        }),
      'Kurs saqlanmoqda...'
    );
    await refreshCoursesAndSummary();
  } catch (error) {
    alert(error.message || 'Kurs yaratilmadi');
  }
}

async function createStudent() {
  const fullName = prompt('Oquvchi F.I.O:');
  if (!fullName) {
    return;
  }

  const email = prompt('Oquvchi emaili:');
  if (!email) {
    return;
  }

  const groupName = prompt('Guruh (masalan 9-A):', '9-A') || '9-A';

  try {
    await withGlobalLoading(
      () =>
        window.eduAuth.apiRequest('/students', {
          method: 'POST',
          body: { fullName, email, groupName },
        }),
      'Oquvchi saqlanmoqda...'
    );
    await refreshStudentsAndSummary();
  } catch (error) {
    alert(error.message || 'Oquvchi qoshilmadi');
  }
}

async function createAssignment() {
  const title = prompt('Topshiriq nomi:');
  if (!title) {
    return;
  }

  const courseId = state.courses[0]?.id || null;
  const totalTasks = Number.parseInt(prompt('Jami topshiriq soni:', '24') || '24', 10);
  const completedTasks = Number.parseInt(prompt('Bajarilgan soni:', '0') || '0', 10);

  try {
    await withGlobalLoading(
      () =>
        window.eduAuth.apiRequest('/assignments', {
          method: 'POST',
          body: {
            title,
            courseId,
            totalTasks: Number.isNaN(totalTasks) ? 0 : totalTasks,
            completedTasks: Number.isNaN(completedTasks) ? 0 : completedTasks,
          },
        }),
      'Topshiriq saqlanmoqda...'
    );
    await refreshAssignmentsAndSummary();
  } catch (error) {
    alert(error.message || 'Topshiriq yaratilmadi');
  }
}

async function saveQuiz() {
  const section = document.getElementById('quiz');
  if (!section) {
    return;
  }

  const titleInput = section.querySelector('.form-grid input[placeholder="Mustaqil ishlash testi"]');
  const timeInput = section.querySelector('.form-grid input[placeholder="15 daqiqa"]');
  const courseSelect = section.querySelector('.form-grid select');

  const title = titleInput?.value?.trim() || '';
  const timeLimitMinutes = Number.parseInt((timeInput?.value || '15').replace(/[^0-9]/g, ''), 10) || 15;
  const courseId = courseSelect?.value || null;

  if (!title) {
    alert('Papka nomini kiriting.');
    return;
  }

  try {
    let createdQuizId = null;
    await withGlobalLoading(async () => {
      const createdQuiz = await window.eduAuth.apiRequest('/quiz', {
        method: 'POST',
        body: { title, courseId, timeLimitMinutes },
      });
      createdQuizId = createdQuiz.data.id;
    }, 'Papka saqlanmoqda...');

    await loadQuizzes();
    await loadReports();
    resetQuizFolderForm();
    if (createdQuizId) {
      openQuizFolder(createdQuizId);
      return;
    }
    alert('Quiz papkasi yaratildi.');
  } catch (error) {
    alert(error.message || 'Quiz papkasi saqlanmadi');
  }
}

async function createKahootSession() {
  const title = prompt('Kahoot session nomi:');
  if (!title) {
    return;
  }

  try {
    const payload = await withGlobalLoading(
      () =>
        window.eduAuth.apiRequest('/kahoot/sessions', {
          method: 'POST',
          body: { title },
        }),
      'Session yaratilmoqda...'
    );

    state.currentKahootSessionId = payload.data.id;
    const badge = document.querySelector('#kahoot .pill.danger');
    if (badge) {
      badge.textContent = `PIN ${payload.data.pin}`;
    }

    if (confirm(`Session yaratildi. PIN: ${payload.data.pin}. Live boshlaymizmi?`)) {
      await window.eduAuth.apiRequest(`/kahoot/sessions/${payload.data.id}/start`, {
        method: 'POST',
      });
    }

    await loadKahootSessions();
  } catch (error) {
    alert(error.message || 'Session yaratilmadi');
  }
}

async function saveKahootQuestion() {
  if (!state.currentKahootSessionId) {
    alert('Avval session yarating yoki tanlang.');
    return;
  }

  const section = document.getElementById('kahoot');
  const questionText = section.querySelector('[data-kahoot-question]')?.value?.trim();
  const timeLimitSeconds = Number.parseInt(
    section.querySelector('.kahoot-side input[type="number"]')?.value || '30',
    10
  );

  const numberInputs = section.querySelectorAll('.kahoot-side input[type="number"]');
  const points = Number.parseInt(numberInputs[1]?.value || '100', 10);
  const correctOption = section.querySelector('.kahoot-side select')?.value || 'A';

  if (!questionText) {
    alert('Savol matnini kiriting.');
    return;
  }

  const optionA = section.querySelector('[data-kahoot-option="A"]')?.value?.trim() || '';
  const optionB = section.querySelector('[data-kahoot-option="B"]')?.value?.trim() || '';
  const optionC = section.querySelector('[data-kahoot-option="C"]')?.value?.trim() || '';
  const optionD = section.querySelector('[data-kahoot-option="D"]')?.value?.trim() || '';

  if (!optionA || !optionB || !optionC || !optionD) {
    alert('Kahoot uchun 4 ta variantni ham kiriting.');
    return;
  }

  try {
    await withGlobalLoading(
      () =>
        window.eduAuth.apiRequest(`/kahoot/sessions/${state.currentKahootSessionId}/questions`, {
          method: 'POST',
          body: {
            questionText,
            optionA,
            optionB,
            optionC,
            optionD,
            correctOption,
            timeLimitSeconds: Number.isNaN(timeLimitSeconds) ? 30 : timeLimitSeconds,
            points: Number.isNaN(points) ? 100 : points,
          },
        }),
      'Kahoot savoli saqlanmoqda...'
    );

    alert('Kahoot savoli saqlandi.');
  } catch (error) {
    alert(error.message || 'Savol saqlanmadi');
  }
}

async function createWordwallSet() {
  const section = document.getElementById('wordwall');
  if (!section) {
    return;
  }

  const titleInput = section.querySelector('#wordwall-title-input');
  const title = String(titleInput?.value || '').trim() || 'Untitled1';
  const clueMode = section.querySelector('input[name="wordwall-clue-mode"]:checked')?.value || 'without';
  const selectedTemplate = section.querySelector('.wordwall-template-card.active')?.dataset.wordwallTemplate || state.currentWordwallTemplate || 'anagram';
  const rows = collectWordwallDraftRows();

  if (rows.length === 0) {
    alert('Kamida bitta soz kiriting.');
    return;
  }

  if (rows.length > 100) {
    alert('Maksimum 100 ta soz qoshish mumkin.');
    return;
  }

  try {
    let createdSetPin = null;

    await withGlobalLoading(async () => {
      const payload = await window.eduAuth.apiRequest('/wordwall/sets', {
          method: 'POST',
          body: { title, templateType: selectedTemplate, clueMode },
      });

      state.currentWordwallSetId = payload.data.id;
      createdSetPin = payload.data.pin || null;

      await Promise.all(
        rows.map((row) => {
          const prompt =
            clueMode === 'with' && row.clue ? row.clue : buildWordwallAnagramPrompt(row.word);

          return window.eduAuth.apiRequest(`/wordwall/sets/${payload.data.id}/items`, {
            method: 'POST',
            body: {
              prompt,
              answer: row.word,
            },
          });
        })
      );

      await loadWordwallSets();
    }, 'Wordwall faoliyati saqlanmoqda...');

    const createdSetId = state.currentWordwallSetId;
    resetWordwallComposer();

    if (createdSetPin) {
      window.location.href = `wordwall-play.html?pin=${encodeURIComponent(createdSetPin)}&autoplay=1`;
      return;
    }

    if (createdSetId) {
      window.location.href = `wordwall-play.html?setId=${encodeURIComponent(createdSetId)}&autoplay=1`;
      return;
    }

    alert('Wordwall activity yaratildi.');
  } catch (error) {
    alert(error.message || 'Wordwall set yaratilmadi');
  }
}

async function addWordwallItem() {
  const section = document.getElementById('wordwall');
  if (!section) {
    return;
  }

  const rowsContainer = section.querySelector('#wordwall-word-rows');
  if (!rowsContainer) {
    return;
  }

  if (rowsContainer.children.length >= 100) {
    alert('Maksimum 100 ta soz qoshish mumkin.');
    return;
  }

  rowsContainer.appendChild(createWordwallRowElement());
  syncWordwallComposerUi();

  const lastWordInput =
    rowsContainer.lastElementChild?.querySelector('[data-wordwall-word]');
  if (lastWordInput) {
    lastWordInput.focus();
  }
}

function normalizeWordwallValue(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function buildWordwallAnagramPrompt(word) {
  const normalized = normalizeWordwallValue(word);
  if (!normalized) {
    return 'Anagram:';
  }

  const shuffledWords = normalized
    .split(' ')
    .filter(Boolean)
    .map((raw) => {
      if (raw.length < 2) {
        return raw;
      }

      let shuffled = raw;
      for (let attempt = 0; attempt < 8 && shuffled.toLowerCase() === raw.toLowerCase(); attempt += 1) {
        const chars = raw.split('');
        for (let i = chars.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [chars[i], chars[j]] = [chars[j], chars[i]];
        }
        shuffled = chars.join('');
      }

      if (shuffled.toLowerCase() === raw.toLowerCase()) {
        shuffled = raw.split('').reverse().join('');
      }

      return shuffled;
    });

  return `Anagram: ${shuffledWords.join(' ')}`;
}

function createWordwallRowElement(word = '', clue = '') {
  const row = document.createElement('div');
  row.className = 'wordwall-entry-row';
  row.innerHTML = `
    <span class="wordwall-row-index">1.</span>
    <div class="wordwall-row-fields">
      <input type="text" data-wordwall-word placeholder="Word" maxlength="120" />
      <input class="wordwall-clue-field" type="text" data-wordwall-clue placeholder="Clue (optional)" maxlength="160" />
    </div>
    <button class="wordwall-row-remove" type="button" data-wordwall-remove-row aria-label="Delete row">×</button>
  `;

  const wordInput = row.querySelector('[data-wordwall-word]');
  const clueInput = row.querySelector('[data-wordwall-clue]');
  if (wordInput) {
    wordInput.value = word;
  }
  if (clueInput) {
    clueInput.value = clue;
  }

  return row;
}

function syncWordwallComposerUi() {
  const section = document.getElementById('wordwall');
  if (!section) {
    return;
  }

  const rows = Array.from(section.querySelectorAll('.wordwall-entry-row'));
  const clueMode = section.querySelector('input[name="wordwall-clue-mode"]:checked')?.value || 'without';
  const showClue = clueMode === 'with';
  const clueHead = section.querySelector('#wordwall-clue-head');

  if (clueHead) {
    clueHead.classList.toggle('wordwall-hidden', !showClue);
  }

  rows.forEach((row, index) => {
    const indexEl = row.querySelector('.wordwall-row-index');
    const clueInput = row.querySelector('.wordwall-clue-field');
    const removeButton = row.querySelector('[data-wordwall-remove-row]');

    if (indexEl) {
      indexEl.textContent = `${index + 1}.`;
    }

    if (clueInput) {
      clueInput.classList.toggle('wordwall-hidden', !showClue);
    }

    if (removeButton) {
      removeButton.disabled = rows.length <= 1;
    }
  });
}

function collectWordwallDraftRows() {
  const section = document.getElementById('wordwall');
  if (!section) {
    return [];
  }

  return Array.from(section.querySelectorAll('.wordwall-entry-row'))
    .map((row) => ({
      word: normalizeWordwallValue(row.querySelector('[data-wordwall-word]')?.value || ''),
      clue: normalizeWordwallValue(row.querySelector('[data-wordwall-clue]')?.value || ''),
    }))
    .filter((row) => row.word);
}

function setWordwallStage(stage = 'template') {
  const section = document.getElementById('wordwall');
  if (!section) {
    return;
  }

  const isContent = stage === 'content';
  state.wordwallStage = isContent ? 'content' : 'template';

  const templateStep = section.querySelector('#wordwall-step-template');
  const contentStep = section.querySelector('#wordwall-step-content');
  const topActions = section.querySelector('#wordwall-top-actions');
  const templateGallery = section.querySelector('.wordwall-template-gallery');
  const editorBox = section.querySelector('#wordwall-editor-box');

  if (templateStep) {
    templateStep.classList.toggle('active', !isContent);
  }

  if (contentStep) {
    contentStep.classList.toggle('active', isContent);
  }

  if (topActions) {
    topActions.classList.toggle('wordwall-hidden', !isContent);
  }

  if (templateGallery) {
    templateGallery.classList.toggle('wordwall-hidden', isContent);
  }

  if (editorBox) {
    editorBox.classList.toggle('wordwall-hidden', !isContent);
  }
}

function resetWordwallComposer() {
  const section = document.getElementById('wordwall');
  if (!section) {
    return;
  }

  const titleInput = section.querySelector('#wordwall-title-input');
  const withoutClues = section.querySelector('input[name="wordwall-clue-mode"][value="without"]');
  const rowsContainer = section.querySelector('#wordwall-word-rows');

  if (titleInput) {
    titleInput.value = 'Untitled1';
  }

  if (withoutClues) {
    withoutClues.checked = true;
  }

  if (rowsContainer) {
    rowsContainer.innerHTML = '';
    rowsContainer.appendChild(createWordwallRowElement());
  }

  const cards = section.querySelectorAll('.wordwall-template-card');
  cards.forEach((card) => {
    card.classList.toggle('active', card.dataset.wordwallTemplate === 'anagram');
  });
  state.currentWordwallTemplate = 'anagram';

  const templateName = section.querySelector('#wordwall-template-name');
  const templateIcon = section.querySelector('.wordwall-template-icon');
  if (templateName) {
    templateName.textContent = 'Anagramma';
  }
  if (templateIcon) {
    templateIcon.textContent = '🔤';
  }

  setWordwallStage('template');
  syncWordwallComposerUi();
}

function initializeWordwallComposer() {
  if (state.wordwallComposerReady) {
    return;
  }

  const section = document.getElementById('wordwall');
  if (!section) {
    return;
  }

  state.wordwallComposerReady = true;

  const rowsContainer = section.querySelector('#wordwall-word-rows');
  if (rowsContainer && rowsContainer.children.length === 0) {
    rowsContainer.appendChild(createWordwallRowElement());
  }

  if (rowsContainer) {
    rowsContainer.addEventListener('click', (event) => {
      const removeButton = event.target.closest('[data-wordwall-remove-row]');
      if (!removeButton) {
        return;
      }

      const row = removeButton.closest('.wordwall-entry-row');
      if (!row) {
        return;
      }

      const rowCount = rowsContainer.querySelectorAll('.wordwall-entry-row').length;
      if (rowCount <= 1) {
        return;
      }

      row.remove();
      syncWordwallComposerUi();
    });
  }

  section.querySelectorAll('input[name="wordwall-clue-mode"]').forEach((input) => {
    input.addEventListener('change', syncWordwallComposerUi);
  });

  section.querySelectorAll('.wordwall-template-card').forEach((card) => {
    card.addEventListener('click', () => {
      section.querySelectorAll('.wordwall-template-card').forEach((item) => item.classList.remove('active'));
      card.classList.add('active');

      const templateType = card.dataset.wordwallTemplate || 'anagram';
      const templateName = card.dataset.wordwallTemplateName || 'Anagramma';
      const templateIcon = card.dataset.wordwallTemplateIcon || '🔤';
      state.currentWordwallTemplate = templateType;

      const templateNameNode = section.querySelector('#wordwall-template-name');
      const templateIconNode = section.querySelector('.wordwall-template-icon');
      if (templateNameNode) {
        templateNameNode.textContent = templateName;
      }
      if (templateIconNode) {
        templateIconNode.textContent = templateIcon;
      }

      setWordwallStage('content');
    });
  });

  const backButton = section.querySelector('#wordwall-back-to-templates-btn');
  if (backButton) {
    backButton.addEventListener('click', () => {
      setWordwallStage('template');
    });
  }

  setWordwallStage('template');
  syncWordwallComposerUi();
}

function showSection(sectionId, options = {}) {
  const { updateHistory = false } = options;
  const normalizedSection = DASHBOARD_SECTIONS.has(sectionId) ? sectionId : 'home';
  const sections = document.querySelectorAll('.section');
  sections.forEach((section) => section.classList.remove('active'));

  const target = document.getElementById(normalizedSection);
  if (target) {
    target.classList.add('active');
  }

  if (updateHistory && normalizedSection !== state.activeSection) {
    history.pushState({ dashboardSection: normalizedSection }, '', `#${normalizedSection}`);
  }

  state.activeSection = normalizedSection;

  const titleMap = {
    home: 'Bosh sahifa',
    courses: 'Kurslar',
    students: "O'quvchilar",
    assignments: 'Topshiriqlar',
    quiz: 'Quizlar',
    kahoot: 'Kahoot',
    wordwall: 'Wordwall',
    reports: 'Natijalar',
    settings: 'Sozlamalar',
  };

  document.getElementById('section-title').textContent = titleMap[normalizedSection] || 'Bosh sahifa';

  if (normalizedSection === 'kahoot') {
    loadKahootSessions().catch(() => {
      // Ignore silent refresh error when switching tabs.
    });
  }

  if (normalizedSection === 'wordwall') {
    initializeWordwallComposer();
  }
}

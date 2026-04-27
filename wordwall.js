const STORAGE_KEY = 'eduskill.wordwallDraft';

const state = {
  templateName: 'Anagram',
  clueMode: 'without',
  rows: [],
};

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function persistDraft() {
  const payload = {
    templateName: state.templateName,
    clueMode: state.clueMode,
    title: document.getElementById('wordwall-title-input')?.value || 'Untitled1',
    rows: state.rows.map((row) => ({
      id: row.id,
      word: row.word,
      clue: row.clue,
    })),
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function setStatus(message) {
  const box = document.getElementById('wordwall-status');
  if (box) {
    box.textContent = message;
  }
}

function syncClueVisibility() {
  const clueHead = document.getElementById('wordwall-clue-head');
  const showClue = state.clueMode === 'with';

  if (clueHead) {
    clueHead.classList.toggle('wordwall-hidden', !showClue);
  }

  document.querySelectorAll('[data-wordwall-clue-column]').forEach((node) => {
    node.classList.toggle('wordwall-hidden', !showClue);
  });
}

function renderRows() {
  const container = document.getElementById('wordwall-word-rows');
  if (!container) {
    return;
  }

  const showClue = state.clueMode === 'with';
  container.innerHTML = state.rows
    .map((row, index) => {
      const clueClass = showClue ? '' : 'wordwall-hidden';
      return `
        <div class="wordwall-entry-row" data-row-id="${row.id}">
          <div class="wordwall-row-index">${index + 1}.</div>
          <div class="wordwall-row-fields">
            <input type="text" data-wordwall-word="${row.id}" placeholder="Word" value="${escapeHtml(row.word)}" />
            <input type="text" data-wordwall-clue-column data-wordwall-clue="${row.id}" placeholder="Clue" value="${escapeHtml(row.clue)}" class="${clueClass}" />
          </div>
          <button type="button" class="wordwall-row-remove" data-wordwall-remove="${row.id}" aria-label="Remove word">×</button>
        </div>
      `;
    })
    .join('');

  syncClueVisibility();

  container.querySelectorAll('[data-wordwall-word]').forEach((input) => {
    input.addEventListener('input', (event) => {
      const rowId = input.dataset.wordwallWord;
      const row = state.rows.find((item) => String(item.id) === String(rowId));
      if (row) {
        row.word = event.target.value;
        persistDraft();
      }
    });
  });

  container.querySelectorAll('[data-wordwall-clue]').forEach((input) => {
    input.addEventListener('input', (event) => {
      const rowId = input.dataset.wordwallClue;
      const row = state.rows.find((item) => String(item.id) === String(rowId));
      if (row) {
        row.clue = event.target.value;
        persistDraft();
      }
    });
  });

  container.querySelectorAll('[data-wordwall-remove]').forEach((button) => {
    button.addEventListener('click', () => {
      if (state.rows.length <= 1) {
        return;
      }

      const rowId = button.dataset.wordwallRemove;
      state.rows = state.rows.filter((item) => String(item.id) !== String(rowId));
      renderRows();
      persistDraft();
    });
  });
}

function addRow(seed = {}) {
  const nextId = Date.now() + Math.floor(Math.random() * 1000);
  state.rows.push({
    id: nextId,
    word: seed.word || '',
    clue: seed.clue || '',
  });
  renderRows();
  persistDraft();
}

function bindEvents() {
  const addButton = document.getElementById('add-wordwall-item-btn');
  if (addButton) {
    addButton.addEventListener('click', () => addRow());
  }

  const doneButton = document.getElementById('create-wordwall-set-btn');
  if (doneButton) {
    doneButton.addEventListener('click', () => {
      persistDraft();
      setStatus("Wordwall sahifasi tayyor. Endi admin va user uchun bir xil ko'rinishda ochildi.");
    });
  }

  const titleInput = document.getElementById('wordwall-title-input');
  if (titleInput) {
    titleInput.addEventListener('input', persistDraft);
  }

  document.querySelectorAll('input[name="wordwall-clue-mode"]').forEach((input) => {
    input.addEventListener('change', (event) => {
      state.clueMode = event.target.value === 'with' ? 'with' : 'without';
      syncClueVisibility();
      persistDraft();
    });
  });

  const templateBtn = document.getElementById('wordwall-switch-template-btn');
  if (templateBtn) {
    templateBtn.addEventListener('click', () => {
      state.templateName = state.templateName === 'Anagram' ? 'Match up' : 'Anagram';
      const nameEl = document.getElementById('wordwall-template-name');
      if (nameEl) {
        nameEl.textContent = state.templateName;
      }
      persistDraft();
    });
  }
}

function init() {
  const draft = loadDraft();
  if (draft) {
    state.templateName = draft.templateName || 'Anagram';
    state.clueMode = draft.clueMode === 'with' ? 'with' : 'without';
    state.rows = Array.isArray(draft.rows) && draft.rows.length > 0
      ? draft.rows.map((row) => ({
          id: row.id || Date.now(),
          word: row.word || '',
          clue: row.clue || '',
        }))
      : [];

    const titleInput = document.getElementById('wordwall-title-input');
    if (titleInput && draft.title) {
      titleInput.value = draft.title;
    }
  }

  if (state.rows.length === 0) {
    addRow({ word: 'salom', clue: '' });
  } else {
    const templateNameEl = document.getElementById('wordwall-template-name');
    if (templateNameEl) {
      templateNameEl.textContent = state.templateName;
    }
    const clueInputs = document.querySelectorAll('input[name="wordwall-clue-mode"]');
    clueInputs.forEach((input) => {
      input.checked = input.value === state.clueMode;
    });
    renderRows();
    persistDraft();
  }

  bindEvents();
  syncClueVisibility();
  setStatus('Wordwall muharriri tayyor. Matnlarni kiriting va Done tugmasini bosing.');
}

document.addEventListener('DOMContentLoaded', init);

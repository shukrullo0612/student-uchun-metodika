const IS_PRODUCTION_HOST = /(^|\.)smartedumetod\.uz$/i.test(window.location.hostname);

const DEFAULT_API_BASE =
  IS_PRODUCTION_HOST
    ? '/api'
    : 'http://localhost:3001/api';

if (IS_PRODUCTION_HOST) {
  localStorage.removeItem('eduskill.apiBase');
}

const API_BASE =
  window.API_BASE_URL ||
  (IS_PRODUCTION_HOST
    ? DEFAULT_API_BASE
    : (localStorage.getItem('eduskill.apiBase') || DEFAULT_API_BASE));

const ACCESS_TOKEN_KEY = 'eduskill.accessToken';
const REFRESH_TOKEN_KEY = 'eduskill.refreshToken';
const USER_KEY = 'eduskill.user';

let refreshInFlight = null;

function migrateLegacyAuthStorage() {
  [ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, USER_KEY].forEach((key) => {
    const inSession = sessionStorage.getItem(key);
    if (inSession) {
      localStorage.removeItem(key);
      return;
    }

    const inLocal = localStorage.getItem(key);
    if (inLocal) {
      sessionStorage.setItem(key, inLocal);
      localStorage.removeItem(key);
    }
  });
}

function getAuthValue(key) {
  return sessionStorage.getItem(key) || localStorage.getItem(key);
}

function setAuthValue(key, value) {
  sessionStorage.setItem(key, value);
  localStorage.removeItem(key);
}

function removeAuthValue(key) {
  sessionStorage.removeItem(key);
  localStorage.removeItem(key);
}

migrateLegacyAuthStorage();

function getAccessToken() {
  return getAuthValue(ACCESS_TOKEN_KEY);
}

function getRefreshToken() {
  return getAuthValue(REFRESH_TOKEN_KEY);
}

function getCurrentUser() {
  const raw = getAuthValue(USER_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function setSession({ accessToken, refreshToken, user }) {
  if (accessToken) {
    setAuthValue(ACCESS_TOKEN_KEY, accessToken);
  }
  if (refreshToken) {
    setAuthValue(REFRESH_TOKEN_KEY, refreshToken);
  }
  if (user) {
    setAuthValue(USER_KEY, JSON.stringify(user));
  }
}

function clearSession() {
  removeAuthValue(ACCESS_TOKEN_KEY);
  removeAuthValue(REFRESH_TOKEN_KEY);
  removeAuthValue(USER_KEY);
}

function isDashboardPage() {
  return window.location.pathname.toLowerCase().includes('dashboard.html');
}

function isStudentPage() {
  return window.location.pathname.toLowerCase().includes('student.html');
}

function redirectByRole(user) {
  if (!user) {
    window.location.href = 'index.html';
    return;
  }

  if (user.role === 'admin') {
    window.location.href = 'dashboard.html';
  } else {
    window.location.href = 'student.html';
  }
}

async function request(path, { method = 'GET', body, auth = true, retry = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && getAccessToken()) {
    headers.Authorization = `Bearer ${getAccessToken()}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
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

  if (response.status === 401 && auth && retry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return request(path, { method, body, auth, retry: false });
    }
  }

  if (!response.ok) {
    const error = new Error(payload.message || 'Request failed');
    error.status = response.status;
    error.code = payload.error;
    throw error;
  }

  return payload;
}

async function refreshAccessToken() {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    const refreshToken = getRefreshToken();

    try {
      const payload = await request('/auth/refresh', {
        method: 'POST',
        body: refreshToken ? { refreshToken } : {},
        auth: false,
        retry: false,
      });

      setSession({
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
        user: payload.user,
      });

      return true;
    } catch (error) {
      clearSession();
      return false;
    }
  })();

  const result = await refreshInFlight;
  refreshInFlight = null;
  return result;
}

function setAuthMode(mode) {
  const normalizedMode = mode === 'signin' ? 'signin' : 'register';
  const form = document.getElementById('auth-form');
  if (!form) {
    return;
  }

  form.dataset.authMode = normalizedMode;

  const title = document.getElementById('auth-title');
  const subtitle = document.getElementById('auth-subtitle');
  const submitBtn = document.getElementById('loginBtn');
  const helperLink = document.getElementById('auth-helper-link');
  const signupNameWrap = document.getElementById('signup-name-wrap');
  const signupFullName = document.getElementById('signupFullName');
  const modeButtons = document.querySelectorAll('.auth-switch-btn[data-auth-mode]');

  modeButtons.forEach((button) => {
    const isActive = button.dataset.authMode === normalizedMode;
    button.classList.toggle('active', isActive);
  });

  if (normalizedMode === 'signin') {
    if (title) {
      title.textContent = 'SIGN IN';
    }
    if (subtitle) {
      subtitle.textContent = "Mavjud akkaunt bilan tizimga kiring.";
    }
    if (submitBtn) {
      submitBtn.textContent = 'SIGN IN';
    }
    if (helperLink) {
      helperLink.textContent = "Akkauntingiz yoqmi? REGISTER";
      helperLink.dataset.switchMode = 'register';
    }
    if (signupNameWrap) {
      signupNameWrap.classList.add('is-hidden');
    }
    if (signupFullName) {
      signupFullName.required = false;
    }
    return;
  }

  if (title) {
    title.textContent = 'REGISTER';
  }
  if (subtitle) {
    subtitle.textContent = "Ro'yxatdan o'tish uchun ma'lumotlaringizni kiriting.";
  }
  if (submitBtn) {
    submitBtn.textContent = 'REGISTER';
  }
  if (helperLink) {
    helperLink.textContent = 'Akkauntingiz bormi? SIGN IN';
    helperLink.dataset.switchMode = 'signin';
  }
  if (signupNameWrap) {
    signupNameWrap.classList.remove('is-hidden');
  }
  if (signupFullName) {
    signupFullName.required = true;
  }
}

async function handleLogin(event) {
  event.preventDefault();

  const form = event.target.closest('form');
  if (!form) {
    return;
  }

  const emailInput = form.querySelector('input[name="email"]') || form.querySelector('input[type="email"]');
  const passwordInput =
    form.querySelector('input[name="password"]') ||
    form.querySelector('#loginPassword') ||
    form.querySelector('input[type="password"], input[type="text"][name="password"]');
  const fullNameInput = form.querySelector('#signupFullName');

  const email = emailInput?.value.trim().toLowerCase() || '';
  const password = passwordInput?.value.trim() || '';
  const fullName = fullNameInput?.value.trim() || '';
  const mode = form.dataset.authMode === 'signin' ? 'signin' : 'register';

  try {
    const endpoint = mode === 'register' ? '/auth/register' : '/auth/login';
    const body = mode === 'register'
      ? { email, password, fullName }
      : { email, password };

    const payload = await request(endpoint, {
      method: 'POST',
      body,
      auth: false,
      retry: false,
    });

    setSession({
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      user: payload.user,
    });

    redirectByRole(payload.user);
  } catch (error) {
    if (error.code === 'RATE_LIMITED') {
      alert('Juda kop urinish. Birozdan keyin qayta urinib koring.');
      return;
    }

    if (mode === 'register') {
      if (error.code === 'EMAIL_EXISTS') {
        alert('Bu email allaqachon mavjud. SIGN IN orqali kiring.');
        setAuthMode('signin');
        return;
      }

      if (error.code === 'WEAK_PASSWORD') {
        alert("Parol kamida 6 ta belgi bo'lishi kerak.");
        return;
      }

      if (error.code === 'MISSING_FIELD') {
        alert("Iltimos, barcha maydonlarni to'ldiring.");
        return;
      }

      alert("Ro'yxatdan o'tishda xatolik yuz berdi.");
      return;
    }

    if (error.code === 'INVALID_CREDENTIALS' || error.code === 'MISSING_FIELD') {
      alert('Email yoki parol notogri.');
      return;
    }

    alert('Kirishda xatolik yuz berdi.');
  }
}

async function checkAuth(requiredRole) {
  if (!getAccessToken()) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      if (isDashboardPage() || isStudentPage()) {
        window.location.href = 'index.html';
      }
      return null;
    }
  }

  try {
    const payload = await request('/auth/verify', { method: 'GET' });
    const user = payload.user || getCurrentUser();
    if (user) {
      setSession({ user });

      if (requiredRole && user.role !== requiredRole) {
        if (requiredRole === 'admin') {
          window.location.href = 'student.html';
        } else if (requiredRole === 'student') {
          window.location.href = 'dashboard.html';
        }
        return null;
      }

      return user;
    }
  } catch (error) {
    clearSession();
    if (isDashboardPage() || isStudentPage()) {
      window.location.href = 'index.html';
    }
    return null;
  }

  if (isDashboardPage() || isStudentPage()) {
    window.location.href = 'index.html';
  }
  return null;
}

async function logout() {
  try {
    if (getAccessToken()) {
      await request('/auth/logout', {
        method: 'POST',
        body: { refreshToken: getRefreshToken() },
        auth: true,
        retry: false,
      });
    }
  } catch (error) {
    // Intentionally ignored to always clear local session.
  } finally {
    clearSession();
    window.location.href = 'index.html';
  }
}

window.eduAuth = {
  API_BASE,
  apiRequest: request,
  checkAuth,
  logout,
  getCurrentUser,
  refreshAccessToken,
};

window.checkAuth = checkAuth;
window.logout = logout;

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.querySelector('.login-box form');
  if (!loginForm) {
    return;
  }

  const passwordInput = loginForm.querySelector('#loginPassword');
  const passwordToggle = loginForm.querySelector('.password-toggle');

  if (passwordInput && passwordToggle) {
    passwordToggle.addEventListener('click', () => {
      const isHidden = passwordInput.type === 'password';
      passwordInput.type = isHidden ? 'text' : 'password';
      passwordToggle.setAttribute(
        'aria-label',
        isHidden ? 'Parolni yashirish' : 'Parolni korsatish'
      );
      passwordToggle.setAttribute(
        'title',
        isHidden ? 'Parolni yashirish' : 'Parolni korsatish'
      );
    });
  }

  loginForm.addEventListener('submit', handleLogin);
  const loginBtn = loginForm.querySelector('#loginBtn');
  if (loginBtn) {
    loginBtn.addEventListener('click', handleLogin);
  }

  const modeButtons = document.querySelectorAll('.auth-switch-btn[data-auth-mode]');
  modeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      setAuthMode(button.dataset.authMode);
    });
  });

  const headerAuthLinks = document.querySelectorAll('[data-auth-target]');
  headerAuthLinks.forEach((link) => {
    link.addEventListener('click', () => {
      setAuthMode(link.dataset.authTarget);
    });
  });

  const helperLink = document.getElementById('auth-helper-link');
  if (helperLink) {
    helperLink.addEventListener('click', (event) => {
      const switchMode = helperLink.dataset.switchMode;
      if (!switchMode) {
        return;
      }
      event.preventDefault();
      setAuthMode(switchMode);
    });
  }

  setAuthMode('signin');
});

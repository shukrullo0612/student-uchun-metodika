import crypto from 'crypto';

const RAW_ADMIN_USERS = [
  {
    email: 'goibnazarovshukrullo@gmail.com',
    password: 'admin123',
    fullName: 'Shukrullo Goibnazarov',
  },
  {
    email: 'dilraborustamova048@gmail.com',
    password: 'dilrabo6880',
    fullName: 'Dilrabo Rustamova',
  },
];

export const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

export const ADMIN_USERS = RAW_ADMIN_USERS.map((user) => ({
  ...user,
  email: normalizeEmail(user.email),
}));

const ADMIN_USERS_BY_EMAIL = new Map(ADMIN_USERS.map((user) => [user.email, user]));

export const isAdminEmail = (email) => ADMIN_USERS_BY_EMAIL.has(normalizeEmail(email));

export const getAdminProfile = (email) => ADMIN_USERS_BY_EMAIL.get(normalizeEmail(email)) || null;

const timingSafeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

export const isValidAdminCredentials = (email, password) => {
  const profile = getAdminProfile(email);
  if (!profile) {
    return false;
  }

  return timingSafeEqual(profile.password, String(password || ''));
};

export const getCanonicalRole = (email) => (isAdminEmail(email) ? 'admin' : 'student');

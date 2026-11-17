import bcrypt from 'bcryptjs';

export const hashPassword = (pw) => bcrypt.hash(pw, 12);
export const checkHash = (pw, hash) => (hash ? bcrypt.compare(String(pw || ''), hash) : Promise.resolve(false));
export const hashPin = (pin) => bcrypt.hash(pin, 10);

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Password must be at least 10 characters.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain letters and numbers.';
  return null;
}

/**
 * First run: if no admin accounts exist, create a superadmin from
 * SUPERADMIN_USERNAME / SUPERADMIN_PASSWORD. There is no built-in default password.
 */
export async function ensureSuperadmin(repo) {
  if ((await repo.countAdmins()) > 0) return;
  const username = process.env.SUPERADMIN_USERNAME || 'superadmin';
  const password = process.env.SUPERADMIN_PASSWORD;
  if (!password) {
    console.warn('[admin] No admin accounts and SUPERADMIN_PASSWORD is not set: the educator dashboard is disabled until you set it.');
    return;
  }
  await repo.createAdmin({ username, passwordHash: await hashPassword(password), role: 'superadmin', displayName: 'Super Admin' });
  console.log(`[admin] Created first superadmin account "${username}" from env`);
}

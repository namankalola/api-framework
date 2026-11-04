/** Read an env var, falling back when it is unset or empty. */
export const env = (name, fallback) => {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
};

export const envInt = (name, fallback) => {
  const value = env(name);
  return value === undefined ? fallback : Number.parseInt(value, 10);
};

export const envBool = (name, fallback) => {
  const value = env(name);
  return value === undefined ? fallback : ['1', 'true', 'yes'].includes(value.toLowerCase());
};

export const envList = (name, fallback = []) => {
  const value = env(name);
  return value === undefined
    ? fallback
    : value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
};

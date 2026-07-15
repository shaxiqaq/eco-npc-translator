const fs = require('fs');
const path = require('path');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeDeep(base, incoming) {
  const source = isPlainObject(base) ? base : {};
  const output = { ...source };

  for (const [key, value] of Object.entries(incoming || {})) {
    output[key] = isPlainObject(value)
      ? mergeDeep(isPlainObject(source[key]) ? source[key] : {}, value)
      : value;
  }

  return output;
}

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

module.exports = {
  mergeDeep,
  readJson,
  writeJson
};

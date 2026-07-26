'use strict';

function pickPidFromList(preferredList, processes) {
  return preferredList
    .map((pid) => Number(pid))
    .find((pid) => Number.isSafeInteger(pid) && pid > 0 && processes.some((process) => process.pid === pid))
    || null;
}

/**
 * Match process by exact window title, then by contained title fragment.
 * Titles are more stable across relaunches than PIDs.
 */
function pickPidByTitle(preferredTitles, processes) {
  const titles = (preferredTitles || [])
    .map((t) => String(t || '').trim())
    .filter(Boolean);
  if (!titles.length || !(processes || []).length) return null;

  for (const title of titles) {
    const exact = processes.find((p) => String(p.title || '').trim() === title);
    if (exact?.pid) return Number(exact.pid);
  }
  for (const title of titles) {
    // Allow short CJK fragments (e.g. 法师) — only skip empty / single-byte noise.
    if (title.length < 2) continue;
    const partial = processes.find((p) => {
      const pt = String(p.title || '').trim();
      return pt.includes(title) || (pt.length >= 2 && title.includes(pt));
    });
    if (partial?.pid) return Number(partial.pid);
  }
  return null;
}

/**
 * Choose main + Xiaoya PIDs after a process list refresh.
 * Preference: previous live PID → configured PID → remembered title → fallbacks.
 */
function resolveSelectedPids({
  processes,
  previousMainPid,
  previousXiaoyaPid,
  configuredMainPid,
  configuredXiaoyaPid,
  rememberedMainTitle,
  rememberedXiaoyaTitle
}) {
  const selectedGamePid = pickPidFromList([previousMainPid, configuredMainPid], processes)
    || pickPidByTitle([rememberedMainTitle], processes)
    || processes.at(-1)?.pid
    || null;

  const selectedXiaoyaPid = pickPidFromList([previousXiaoyaPid, configuredXiaoyaPid], processes)
    || pickPidByTitle([rememberedXiaoyaTitle], processes)
    || processes.find((process) => process.pid !== selectedGamePid)?.pid
    || selectedGamePid
    || null;

  return { selectedGamePid, selectedXiaoyaPid };
}

function processExistsInList(processes, pid) {
  const normalized = Number(pid);
  return (processes || []).some((process) => process.pid === normalized);
}

module.exports = {
  pickPidFromList,
  pickPidByTitle,
  resolveSelectedPids,
  processExistsInList
};

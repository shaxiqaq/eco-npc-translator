'use strict';

function pickPidFromList(preferredList, processes) {
  return preferredList
    .map((pid) => Number(pid))
    .find((pid) => Number.isSafeInteger(pid) && pid > 0 && processes.some((process) => process.pid === pid))
    || null;
}

/**
 * Choose main + Xiaoya PIDs after a process list refresh.
 */
function resolveSelectedPids({
  processes,
  previousMainPid,
  previousXiaoyaPid,
  configuredMainPid,
  configuredXiaoyaPid
}) {
  const selectedGamePid = pickPidFromList([previousMainPid, configuredMainPid], processes)
    || processes.at(-1)?.pid
    || null;

  const selectedXiaoyaPid = pickPidFromList([previousXiaoyaPid, configuredXiaoyaPid], processes)
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
  resolveSelectedPids,
  processExistsInList
};

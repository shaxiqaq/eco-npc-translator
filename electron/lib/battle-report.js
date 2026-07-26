'use strict';

/**
 * Lightweight session battle report built from periodic snapshots.
 * No heavy charting — export text/JSON for share or later analysis.
 */
function createBattleReportTracker() {
  let session = null;

  function ensure() {
    if (!session) reset();
    return session;
  }

  function reset() {
    session = {
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      samples: 0,
      peakDps: 0,
      peakDealt: 0,
      last: null,
      skillCastTotals: {},
      history: [] // compact { t, dps, dealt }
    };
    return session;
  }

  function ingest(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return ensure();
    const s = ensure();
    s.updatedAt = new Date().toISOString();
    s.samples += 1;
    const dps = Number(snapshot.dps) || 0;
    const dealt = Number(snapshot.dealt) || 0;
    if (dps > s.peakDps) s.peakDps = dps;
    if (dealt > s.peakDealt) s.peakDealt = dealt;
    s.last = {
      elapsed: snapshot.elapsed,
      active: snapshot.active,
      dealt: snapshot.dealt,
      taken: snapshot.taken,
      dps: snapshot.dps,
      skill_dps: snapshot.skill_dps,
      normal_dps: snapshot.normal_dps,
      pet_dps: snapshot.pet_dps,
      skill_dealt: snapshot.skill_dealt,
      normal_dealt: snapshot.normal_dealt,
      pet_dealt: snapshot.pet_dealt,
      max_skill_dealt: snapshot.max_skill_dealt,
      skill_cast_total: snapshot.skill_cast_total,
      self_id: snapshot.self_id
    };
    for (const item of snapshot.skill_casts || []) {
      const id = Number(item.skill_id);
      if (!Number.isInteger(id) || id <= 0) continue;
      const key = String(id);
      const prev = s.skillCastTotals[key] || { skill_id: id, skill: item.skill || `技能#${id}`, count: 0 };
      prev.count = Math.max(prev.count, Number(item.count) || 0);
      if (item.skill) prev.skill = item.skill;
      s.skillCastTotals[key] = prev;
    }
    // Keep a short DPS trail (~last 120 samples)
    s.history.push({
      t: Date.now(),
      dps,
      dealt
    });
    if (s.history.length > 120) s.history.splice(0, s.history.length - 120);
    return s;
  }

  function snapshot() {
    const s = ensure();
    const skills = Object.values(s.skillCastTotals).sort((a, b) => (b.count || 0) - (a.count || 0));
    return {
      startedAt: s.startedAt,
      updatedAt: s.updatedAt,
      samples: s.samples,
      peakDps: s.peakDps,
      peakDealt: s.peakDealt,
      last: s.last,
      topSkills: skills.slice(0, 15),
      history: s.history.slice()
    };
  }

  function formatText(report = snapshot(), { characterTitle = '' } = {}) {
    const last = report.last || {};
    const lines = [
      '# ECO 战斗报告',
      `# 生成: ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
      `# 会话开始: ${report.startedAt || '-'}`,
      characterTitle ? `# 角色窗口: ${characterTitle}` : '',
      last.self_id != null ? `# 角色 ID: ${last.self_id}` : '',
      '',
      '## 汇总',
      `- 峰值 DPS: ${Number(report.peakDps || 0).toFixed(2)}`,
      `- 峰值总伤: ${report.peakDealt || 0}`,
      `- 当前 DPS: ${Number(last.dps || 0).toFixed(2)}`,
      `- 技能 DPS: ${Number(last.skill_dps || 0).toFixed(2)}`,
      `- 普攻 DPS: ${Number(last.normal_dps || 0).toFixed(2)}`,
      `- 宠物 DPS: ${Number(last.pet_dps || 0).toFixed(2)}`,
      `- 总造成: ${last.dealt || 0}`,
      `- 总受到: ${last.taken || 0}`,
      `- 最大技能: ${last.max_skill_dealt || 0}`,
      `- 技能释放次数: ${last.skill_cast_total || 0}`,
      `- 战斗时长(秒): ${last.active ?? last.elapsed ?? '-'}`,
      '',
      '## 技能释放 Top',
      ...(report.topSkills || []).map((s, i) => `${i + 1}. ${s.skill || s.skill_id} ×${s.count}`),
      '',
      '## DPS 轨迹（最近采样）',
      ...(report.history || []).slice(-20).map((h) => {
        const time = new Date(h.t).toLocaleTimeString('zh-CN', { hour12: false });
        return `${time}  dps=${Number(h.dps || 0).toFixed(2)}  dealt=${h.dealt || 0}`;
      }),
      ''
    ].filter((line) => line !== '');
    return lines.join('\n');
  }

  return {
    reset,
    ingest,
    snapshot,
    formatText
  };
}

module.exports = { createBattleReportTracker };

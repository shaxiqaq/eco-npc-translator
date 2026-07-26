'use strict';

/** Synthetic damage/buff snapshot for ECO_UI_DEMO mode. */
function demoSnapshot(seed) {
  const now = new Date();
  const nowSeconds = Date.now() / 1000;
  const hits = [
    { side: 'dealt', skill_id: 3001, skill: '法箭', damage: 283, source: '自己#1699', target: '沙地爬行者#11460' },
    { side: 'normal_dealt', skill_id: null, skill: '普通攻击', damage: 21, source: '自己#1699', target: '沙地爬行者#11434' },
    { side: 'pet_dealt', skill_id: 7505, skill: '钝吧！', damage: 30, source: '宠物#4412', target: '沙地爬行者#11434' },
    { side: 'taken', skill_id: null, skill: '普通攻击', damage: 7, source: '沙地爬行者#11434', target: '自己#1699' }
  ].map((item, index) => ({
    ...item,
    side: item.side === 'normal_dealt' ? 'dealt' : item.side,
    time: new Date(now - index * 1100).toLocaleTimeString('zh-CN', { hour12: false }),
    source_kind: item.skill_id ? '技能结果包' : '伤害包'
  }));
  return {
    elapsed: 72 + seed,
    active: 48 + seed,
    self_id: 1699,
    dealt: 1159 + seed * 3,
    taken: 26,
    skill_dealt: 878 + seed * 2,
    normal_dealt: 281 + seed,
    skill_taken: 0,
    normal_taken: 26,
    pet_dealt: 146 + seed,
    pet_skill_dealt: 90,
    pet_normal_dealt: 56 + seed,
    hits_skill_dealt: 4,
    hits_normal_dealt: 23,
    hits_skill_taken: 0,
    hits_normal_taken: 6,
    hits_pet_dealt: 9,
    max_skill_dealt: 354,
    max_normal_dealt: 23,
    max_taken: 7,
    max_pet_dealt: 30,
    skill_dps: 18.29,
    normal_dps: 5.85,
    pet_dps: 3.04,
    dps: 24.14,
    tps: 0.54,
    skills_dealt: [[3127, 354], [3001, 283], [3123, 240]],
    skills_taken: [],
    pet_skills: [[7505, 90]],
    damage_history: hits,
    buffs: [
      { key: 'magic_shield', name: '魔法护盾', source_name: 'MAGIC_SHIELD', category: 'positive', skill_id: 3114, timing: 'estimated_observed', started_at: nowSeconds - 72, expires_at: nowSeconds + 828, elapsed: 72, remaining: 828 },
      { key: '3:0x00000020', name: '魔法攻击力上升', source_name: 'MAGIC_ATK_UP', category: 'positive', timing: 'elapsed_only', started_at: nowSeconds - 31, expires_at: null, elapsed: 31, remaining: null },
      { key: '4:0x00000008', name: '移动速度下降', source_name: 'SPEED_DOWN', category: 'negative', timing: 'elapsed_only', started_at: nowSeconds - 14, expires_at: null, elapsed: 14, remaining: null },
      { key: '0:0x00000004', name: '沉默', source_name: 'SILENCE', category: 'abnormal', timing: 'estimated_learned', started_at: nowSeconds - 5, expires_at: nowSeconds + 11, elapsed: 5, remaining: 11 }
    ],
    buff_history: [
      { event: 'gained', time: nowSeconds - 72, key: 'magic_shield', name: '魔法护盾', category: 'positive', skill_id: 3114 },
      { event: 'gained', time: nowSeconds - 31, key: '3:0x00000020', name: '魔法攻击力上升', category: 'positive' },
      { event: 'gained', time: nowSeconds - 14, key: '4:0x00000008', name: '移动速度下降', category: 'negative' },
      { event: 'gained', time: nowSeconds - 5, key: '0:0x00000004', name: '沉默', category: 'abnormal' }
    ],
    buff_version: 4,
    skill_cooldowns: [
      {
        key: 'skill_cd:2100',
        skill_id: 2100,
        skill: 'パリイ',
        name: 'パリイ',
        category: 'cooldown',
        timing: 'custom',
        started_at: nowSeconds - 8,
        expires_at: nowSeconds + 22,
        duration: 30,
        elapsed: 8,
        remaining: 22
      }
    ],
    skill_effect_timers: [
      {
        key: 'skill_effect:2100',
        skill_id: 2100,
        skill: 'パリイ',
        name: 'パリイ',
        category: 'skill_duration',
        timing: 'custom',
        started_at: nowSeconds - 1,
        expires_at: nowSeconds + 2,
        duration: 3,
        elapsed: 1,
        remaining: 2
      }
    ],
    skill_casts: [
      { skill_id: 2100, skill: 'パリイ', count: 4, role: 'defensive' },
      { skill_id: 3114, skill: '魔法护盾', count: 1, role: 'self' }
    ]
  };
}

module.exports = { demoSnapshot };

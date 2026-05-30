import xlsx from 'xlsx';
import { SCHOOLS } from './constants.js';
import { getDb, useMongo } from './db.js';
import { Submission } from './models.js';

// ==================== 工具函数 ====================

/** 安全解析数字，无效时返回 0 */
function num(val) {
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

/** 累加数组中指定字段 */
function sum(items, field) {
  return items.reduce((s, item) => s + num(item[field]), 0);
}

/** 收集所有非空文本，用分号分隔，最多取 maxItems 条；过滤占位符 */
function joinTexts(items, field, maxItems = 3) {
  const PLACEHOLDERS = ['无', '无。', '（未填）', '—', '-', '暂无'];
  const texts = items
    .map(it => it[field])
    .filter(t => t && String(t).trim())
    .map(t => String(t).trim())
    .filter(t => !PLACEHOLDERS.includes(t));
  if (!texts.length) return '';
  // 去重
  const unique = [...new Set(texts)];
  const selected = unique.slice(0, maxItems);
  return selected.join('；') + (unique.length > maxItems ? ` 等${unique.length}条` : '');
}

/** 数字转描述文本，0/空值返回 '（未填）' */
function desc(value, prefix = '', suffix = '') {
  if (value === null || value === undefined || value === '') return '（未填）';
  const n = Number(value);
  if (isNaN(n)) return '（未填）';
  if (n === 0) return '（未填）';
  return `${prefix}${n}${suffix}`;
}

/** 获取每个学校的最新提交记录，支持按提交日期范围过滤（过滤软删除） */
async function getLatestSubs(startDate, endDate) {
  let submissions;
  if (useMongo()) {
    const query = { deleted: false };
    if (startDate || endDate) {
      // 日期范围过滤在代码中处理
    }
    const docs = await Submission.find(query).lean();
    submissions = docs.map(doc => {
      const obj = { ...doc };
      delete obj._id; delete obj.__v; delete obj.createdAt; delete obj.updatedAt;
      return obj;
    });
  } else {
    const db = getDb();
    submissions = db.submissions;
  }

  const map = new Map();
  for (const sub of submissions) {
    // 过滤软删除记录
    if (sub.deleted) continue;
    // 日期过滤
    if (startDate || endDate) {
      const subDateStr = sub.submitted_at ?
        (sub.submitted_at instanceof Date ?
          sub.submitted_at.toISOString().substring(0, 10) :
          String(sub.submitted_at).substring(0, 10)) : '';
      if (startDate && subDateStr < startDate) continue;
      if (endDate && subDateStr > endDate) continue;
    }
    const existing = map.get(sub.school_name);
    const subDate = sub.submitted_at ? new Date(sub.submitted_at) : new Date(0);
    const existingDate = existing && existing.submitted_at ? new Date(existing.submitted_at) : new Date(0);
    if (!existing || subDate > existingDate) {
      map.set(sub.school_name, sub);
    }
  }
  return Array.from(map.values());
}

/** 筛选指定日期范围内的提交（过滤软删除） */
async function getSubsInPeriod(startDate, endDate) {
  let submissions;
  if (useMongo()) {
    const query = { deleted: false };
    const docs = await Submission.find(query).lean();
    submissions = docs.map(doc => {
      const obj = { ...doc };
      delete obj._id; delete obj.__v; delete obj.createdAt; delete obj.updatedAt;
      return obj;
    });
  } else {
    const db = getDb();
    submissions = db.submissions;
  }

  return submissions.filter(sub => {
    if (sub.deleted) return false;
    return sub.period_start >= startDate && sub.period_end <= endDate;
  });
}

// ==================== Sheet1: 数据统计 ====================

async function buildStatsSheet(startDate, endDate) {
  // 取每个学校的最新提交进行汇总（已过滤软删除）
  const subs = await getLatestSubs();

  // 当前日期字符串
  const now = new Date();
  const dateStr = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月${String(now.getDate()).padStart(2, '0')}日`;

  // ===== 汇总各项数据 =====

  // --- 省级宣讲 ---
  // 只取本周有宣讲活动的学校描述
  const lectureActiveSubs = subs.filter(s => num(s.q8_weekly_lectures) > 0);
  const provincialDesc = joinTexts(lectureActiveSubs, 'q15_provincial_desc') || '—';

  // --- 校级宣讲（本周X场覆盖Y人；累计X场覆盖Y人）---
  const wLectures = sum(subs, 'q8_weekly_lectures');
  const wReach    = sum(subs, 'q9_weekly_reach');
  const culLectures = sum(subs, 'q10_cumul_lectures');
  const culReach    = sum(subs, 'q11_cumul_reach');
  let schoolLectureText = '';
  if (wLectures > 0 || wReach > 0) {
    schoolLectureText += `本周${wLectures || 0}场，覆盖${wReach || 0}人次`;
  }
  if (culLectures > 0 || culReach > 0) {
    if (schoolLectureText) schoolLectureText += '；';
    schoolLectureText += `累计${culLectures || 0}场，覆盖${culReach || 0}人次`;
  }
  if (!schoolLectureText) schoolLectureText = '（未填）';

  // --- 主题团日（本周X场；累计X场）---
  const wTuanri = sum(subs, 'q13_weekly_tuanri');
  const culTuanri = sum(subs, 'q14_cumul_tuanri');
  let tuanriText = '';
  if (wTuanri > 0) tuanriText += `本周${wTuanri}场`;
  if (culTuanri > 0) {
    if (tuanriText) tuanriText += '；';
    tuanriText += `累计${culTuanri}场`;
  }
  if (!tuanriText) tuanriText = '—';

  // --- 千校万岗：招聘活动 ---
  const wRecruit    = sum(subs, 'q16_weekly_recruit');
  const cRecruit    = sum(subs, 'q19_cumul_recruit');
  const wCompanies  = sum(subs, 'q17_weekly_companies');
  const wJobs       = sum(subs, 'q18_weekly_jobs');
  const cCompanies  = sum(subs, 'q20_cumul_companies');
  const cJobs       = sum(subs, 'q21_cumul_jobs');

  const recruitText = (wRecruit > 0 || cRecruit > 0)
    ? `本周${wRecruit || 0}场；累计${cRecruit || 0}场`
    : '—';
  // 按照模板格式：累计参与企业数（岗位数）
  const companiesText = (cCompanies > 0 || cJobs > 0)
    ? `${cCompanies || 0}家（${cJobs || 0}个岗位）`
    : '—';

  // --- 政务实习 ---
  const govText = buildInternText(
    sum(subs, 'q22_gov_units'), sum(subs, 'q23_gov_jobs'), sum(subs, 'q24_gov_students'),
    sum(subs, 'q25_cumul_gov_units'), sum(subs, 'q26_cumul_gov_jobs'), sum(subs, 'q27_cumul_gov_students')
  );

  // --- 企业实习 ---
  const entText = buildInternText(
    sum(subs, 'q28_ent_units'), sum(subs, 'q29_ent_jobs'), sum(subs, 'q30_ent_students'),
    sum(subs, 'q31_cumul_ent_units'), sum(subs, 'q32_cumul_ent_jobs'), sum(subs, 'q33_cumul_ent_students')
  );

  // --- 职场体验 ---
  const wExpSessions = sum(subs, 'q34_exp_sessions');
  const wExpReach    = sum(subs, 'q35_exp_reach');
  const cExpSessions = sum(subs, 'q36_cumul_exp_sessions');
  const cExpReach    = sum(subs, 'q37_cumul_exp_reach');
  // 按照模板格式：累计开展X场，覆盖Y人次。
  const expText = (cExpSessions > 0 || cExpReach > 0)
    ? `累计开展${cExpSessions || 0}场，覆盖${cExpReach || 0}人次。`
    : '—';

  // --- 青春小店：高校 ---
  const newShops      = sum(subs, 'q38_new_shops');
  const culShops      = sum(subs, 'q39_cumul_shops');
  const culShopStu    = sum(subs, 'q40_cumul_students');
  // 按照模板格式：高校"青春小店"X家（其中参与创业学生Y人）
  const campusShopText = (culShops > 0 || culShopStu > 0)
    ? `高校"青春小店"${culShops || 0}家（其中参与创业学生${culShopStu || 0}人）`
    : '—';

  // --- 青春小店：城市 ---
  const cityShopText = joinTexts(subs, 'q45_city_shops_desc') || '—';

  // --- 国赛获奖项目 ---
  // 按照模板格式：项目落地X个，成立公司Y家，引进人才Z名，配套支持资金W万元。
  const natActiveSubs = subs.filter(s => num(s.q41_national_landings) > 0);
  const nLand   = sum(subs, 'q41_national_landings');
  const nComp   = sum(subs, 'q41_national_companies');
  const nTalent = sum(subs, 'q41_national_talents');
  const nFund   = sum(subs, 'q41_national_funds');
  const nDesc   = joinTexts(natActiveSubs, 'q42_national_desc');
  const nationalText = buildCompetitionText(nLand, nComp, nTalent, nFund, nDesc);

  // --- 省赛获奖项目 ---
  const provActiveSubs = subs.filter(s => num(s.q43_provincial_landings) > 0);
  const pLand   = sum(subs, 'q43_provincial_landings');
  const pComp   = sum(subs, 'q43_provincial_companies');
  const pTalent = sum(subs, 'q43_provincial_talents');
  const pFund   = sum(subs, 'q43_provincial_funds');
  const pDesc   = joinTexts(provActiveSubs, 'q44_provincial_desc');
  const provincialText = buildCompetitionText(pLand, pComp, pTalent, pFund, pDesc);

  // --- 调研工作：收集所有调研条目 ---
  const researchList = [];
  const publicityList = [];
  for (const sub of subs) {
    for (const item of sub.research_items || []) {
      const name = item.name || item.item_name || '';
      const trimmed = name.trim();
      if (trimmed && trimmed !== '无' && trimmed !== '无。') {
        researchList.push(`${trimmed}`);
      }
    }
    for (const item of sub.publicity_items || []) {
      const activity = item.activity_name || item.name || '';
      const trimmed = activity.trim();
      if (trimmed && trimmed !== '无' && trimmed !== '无。') {
        publicityList.push(`${trimmed}`);
      }
    }
  }

  // ===== 构建二维数组数据 =====
  const rows = [];

  // Row 0: 标题
  rows.push(['2026年"共青团服务和促进大学生就业行动"工作信息统计表', '', '', '', '']);

  // Row 1: 省份+日期
  rows.push([`省份：上海                                                  数据截至：${dateStr}`, '', '', '', '']);

  // Row 2: 一级表头
  rows.push(['工作项目', '各项工作进展情况统计', '', '', '']);

  // ---- Rows 3-5: 大学生就业引航计划 ----
  rows.push([
    '大学生就业引航计划',
    '省级宣讲情况\n（含全国示范宣讲）',
    '',
    '校级宣讲情况',
    '就业观念引导\n主题团日活动情况'
  ]);
  rows.push(['', '场次及覆盖规模', '', '场次及覆盖规模', '场次']);
  rows.push(['', provincialDesc, '', schoolLectureText, tuanriText]);

  // ---- Rows 6-8: 千校万岗 ----
  rows.push([
    '"千校万岗"系列招聘计划',
    '各级团组织主办（含联合有关部门单位共同主办）的其他招聘活动情况（不包括"央企云招聘""就业有位来"活动）',
    '',
    '',
    ''
  ]);
  rows.push(['', '场次', '', '参与企业数量\n（其中提供就业岗位数量）', '']);
  rows.push(['', recruitText, '', companiesText, '']);

  // ---- Rows 9-11: 大学生就业实习/扬帆计划 ----
  rows.push([
    "大学生就业实习\n'扬帆计划'",
    '大学生就业实习（含政务实习、企业实习）情况',
    '',
    '大学生职场体验活动情况',
    ''
  ]);
  rows.push(['', '政务实习情况', '企业实习情况', '场次', '覆盖规模']);
  rows.push(['', govText, entText, expText, '']);

  // ---- Rows 12-14: 创业带动就业 ----
  rows.push(['创业带动就业*', '青春小店情况', '', '成果孵化转化情况', '']);
  rows.push(['', '高校"青春小店"', '城市"青春小店"', '国赛获奖项目\n孵化转化情况[2]', '省赛获奖项目\n孵化转化情况[2]']);
  rows.push(['', campusShopText, cityShopText, nationalText, provincialText]);

  // ---- Rows 15-17: 其他有关工作 ----
  rows.push(['其他有关工作', '调研工作开展情况', '', '相关工作活动宣传情况', '']);
  rows.push([
    '',
    researchList.length ? researchList.join('\n') : '—',
    '',
    publicityList.length ? publicityList.join('\n') : '—',
    ''
  ]);
  rows.push(['', '', '', '', '']);

  // Row 18: 备注
  rows.push([
    '备注：\n[1]省内高校宣讲活动覆盖率（%）=省内已开展校级宣讲活动高校数/省内高校总数；\n[2]国赛/省赛获奖项目孵化转化情况：填写各级团组织为国赛/省赛获奖项目链接的政策、资金、场地、资源情况以及支持的项目数量。\n[*]创业带动就业数据可双周更新，其余数据均按周更新。',
    '',
    '',
    '',
    ''
  ]);

  // ===== 合并单元格定义 (0-based) =====
  const merges = [
    // 标题行
    { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
    // 省份日期行
    { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } },
    // 一级表头
    { s: { r: 2, c: 0 }, e: { r: 2, c: 4 } },

    // --- 大学生就业引航计划 ---
    { s: { r: 3, c: 0 }, e: { r: 5, c: 0 } },   // A4:A6
    { s: { r: 3, c: 1 }, e: { r: 3, c: 2 } },   // B4:C4
    { s: { r: 4, c: 1 }, e: { r: 4, c: 2 } },   // B5:C5
    { s: { r: 4, c: 3 }, e: { r: 4, c: 4 } },   // D5:E5
    { s: { r: 5, c: 1 }, e: { r: 5, c: 2 } },   // B6:C6
    { s: { r: 5, c: 3 }, e: { r: 5, c: 4 } },   // D6:E6

    // --- 千校万岗 ---
    { s: { r: 6, c: 0 }, e: { r: 8, c: 0 } },   // A7:A9
    { s: { r: 6, c: 1 }, e: { r: 6, c: 4 } },   // B7:E7
    { s: { r: 7, c: 1 }, e: { r: 7, c: 2 } },   // B8:C8
    { s: { r: 7, c: 3 }, e: { r: 7, c: 4 } },   // D8:E8
    { s: { r: 8, c: 1 }, e: { r: 8, c: 2 } },   // B9:C9
    { s: { r: 8, c: 3 }, e: { r: 8, c: 4 } },   // D9:E9

    // --- 大学生就业实习 ---
    { s: { r: 9, c: 0 }, e: { r: 11, c: 0 } },  // A10:A12
    { s: { r: 9, c: 1 }, e: { r: 9, c: 2 } },   // B10:C10
    { s: { r: 9, c: 3 }, e: { r: 9, c: 4 } },   // D10:E10

    // --- 创业带动就业 ---
    { s: { r: 12, c: 0 }, e: { r: 14, c: 0 } }, // A13:A15
    { s: { r: 12, c: 1 }, e: { r: 12, c: 2 } }, // B13:C13
    { s: { r: 12, c: 3 }, e: { r: 12, c: 4 } }, // D13:E13
    { s: { r: 13, c: 1 }, e: { r: 13, c: 2 } }, // B14:C14
    { s: { r: 13, c: 3 }, e: { r: 13, c: 4 } }, // D14:E14
    { s: { r: 14, c: 1 }, e: { r: 14, c: 2 } }, // B15:C15
    { s: { r: 14, c: 3 }, e: { r: 14, c: 4 } }, // D15:E15

    // --- 其他有关工作 ---
    { s: { r: 15, c: 0 }, e: { r: 17, c: 0 } }, // A16:A18
    { s: { r: 15, c: 1 }, e: { r: 15, c: 2 } }, // B16:C16
    { s: { r: 15, c: 3 }, e: { r: 15, c: 4 } }, // D16:E16
    { s: { r: 16, c: 1 }, e: { r: 16, c: 2 } }, // B17:C17
    { s: { r: 16, c: 3 }, e: { r: 16, c: 4 } }, // D17:E17
    { s: { r: 17, c: 1 }, e: { r: 17, c: 2 } }, // B18:C18
    { s: { r: 17, c: 3 }, e: { r: 17, c: 4 } }, // D18:E18

    // --- 备注 ---
    { s: { r: 18, c: 0 }, e: { r: 18, c: 4 } }, // A19:E19
  ];

  // ===== 列宽 =====
  const cols = [
    { wch: 22 },  // A
    { wch: 28 },  // B
    { wch: 28 },  // C
    { wch: 28 },  // D
    { wch: 28 },  // E
  ];

  const ws = xlsx.utils.aoa_to_sheet(rows);
  ws['!merges'] = merges;
  ws['!cols'] = cols;

  // 设置行高，让内容更美观
  ws['!rows'] = [
    { hpt: 36 },   // Row 0 标题
    { hpt: 24 },   // Row 1
    { hpt: 24 },   // Row 2
    { hpt: 48 },   // Row 3
    { hpt: 24 },   // Row 4
    { hpt: 56 },   // Row 5 数据
    { hpt: 36 },   // Row 6
    { hpt: 36 },   // Row 7
    { hpt: 56 },   // Row 8 数据
    { hpt: 42 },   // Row 9
    { hpt: 24 },   // Row 10
    { hpt: 56 },   // Row 11 数据
    { hpt: 24 },   // Row 12
    { hpt: 24 },   // Row 13
    { hpt: 56 },   // Row 14 数据
    { hpt: 24 },   // Row 15
    { hpt: 80 },   // Row 16 调研/宣传内容可能较多
    { hpt: 12 },   // Row 17 空行
    { hpt: 56 },   // Row 18 备注
  ];

  return ws;
}

/** 构建实习文本描述 */
function buildInternText(wUnits, wJobs, wStu, cUnits, cJobs, cStu) {
  const weekParts = [];
  if (wUnits > 0) weekParts.push(`开发${wUnits}家单位`);
  if (wJobs > 0) weekParts.push(`${wJobs}个岗位`);
  if (wStu > 0) weekParts.push(`上岗${wStu}人`);

  const cumulParts = [];
  if (cUnits > 0) cumulParts.push(`开发${cUnits}家单位`);
  if (cJobs > 0) cumulParts.push(`${cJobs}个岗位`);
  if (cStu > 0) cumulParts.push(`上岗${cStu}人`);

  if (!weekParts.length && !cumulParts.length) return '（未填）';

  const lines = [];
  if (weekParts.length) lines.push('本周：' + weekParts.join('，'));
  if (cumulParts.length) lines.push('累计：' + cumulParts.join('，'));
  return lines.join('\n');
}

/** 构建竞赛项目文本描述 */
function buildCompetitionText(landings, companies, talents, funds, desc) {
  const parts = [];
  if (landings > 0) parts.push(`落地${landings}个`);
  if (companies > 0) parts.push(`成立公司${companies}家`);
  if (talents > 0) parts.push(`引进人才${talents}名`);
  if (funds > 0) parts.push(`配套支持资金${Number(funds).toFixed(2)}万元`);

  let text = parts.length ? parts.join('，') : '（未填）';
  if (desc) {
    text += '\n' + desc;
  }
  return text;
}

// ==================== Sheet2: 活动情况 ====================

async function buildActivitiesSheet(startDate, endDate) {
  let submissions;
  if (useMongo()) {
    const docs = await Submission.find({ deleted: false }).lean();
    submissions = docs.map(doc => {
      const obj = { ...doc };
      delete obj._id; delete obj.__v; delete obj.createdAt; delete obj.updatedAt;
      return obj;
    });
  } else {
    const db = getDb();
    submissions = db.submissions;
  }
  const rows = [];

  // Row 0: 标题
  rows.push(['2026年"共青团服务和促进大学生就业行动"活动信息统计表', '', '', '', '', '', '', '', '', '', '', '']);

  // Row 1: 二级表头（上级）
  rows.push(['序号', '省份', '拟开展活动', '', '', '', '', '已开展活动', '', '', '', '']);

  // Row 2: 三级表头
  rows.push([
    '', '',           // A, B
    '活动时间', '活动名称', '活动地点', '主承办单位', '活动简介（100字）',  // C-G
    '新闻标题', '推送时间', '推送平台', '报道链接', '活动摘要（100字以内）'  // H-L
  ]);

  // ===== 收集活动数据（过滤软删除） =====
  // 先按日期范围过滤提交记录，排除已软删除的
  let filteredSubmissions = submissions.filter(s => !s.deleted);
  if (startDate || endDate) {
    filteredSubmissions = filteredSubmissions.filter(sub => {
      const subDateStr = sub.submitted_at ?
        (sub.submitted_at instanceof Date ?
          sub.submitted_at.toISOString().substring(0, 10) :
          String(sub.submitted_at).substring(0, 10)) : '';
      if (startDate && subDateStr < startDate) return false;
      if (endDate && subDateStr > endDate) return false;
      return true;
    });
  }

  // 遍历过滤后的提交，按学校分组，将拟开展和已开展配对放在同一行
  let seq = 1;

  for (const sub of filteredSubmissions) {
    const planned = sub.planned_activities || [];
    const completed = sub.completed_activities || [];
    const maxLen = Math.max(planned.length, completed.length);

    if (maxLen === 0) continue;

    for (let i = 0; i < maxLen; i++) {
      const p = planned[i] || {};
      const c = completed[i] || {};

      rows.push([
        seq++,                                    // A 序号
        '上海',                                    // B 省份
        p.activity_date || p.date || '',          // C 活动时间
        p.name || '',                             // D 活动名称
        p.location || '',                         // E 活动地点
        p.organizer || '',                        // F 主承办单位
        p.description || p.intro || '',           // G 活动简介
        c.news_title || c.newsTitle || '',        // H 新闻标题
        c.pub_date || c.pubDate || '',            // I 推送时间
        c.platform || '',                         // J 推送平台
        c.link || c.url || '',                    // K 报道链接
        c.summary || ''                           // L 活动摘要
      ]);
    }
  }

  // 如果没有活动数据，添加空行提示
  if (rows.length === 3) {
    rows.push(['', '', '', '', '', '', '', '', '', '', '', '']);
  }

  // ===== 合并单元格定义 =====
  const merges = [
    // 标题行
    { s: { r: 0, c: 0 }, e: { r: 0, c: 11 } },
    // 二级表头：拟开展活动 C1:G1
    { s: { r: 1, c: 2 }, e: { r: 1, c: 6 } },
    // 二级表头：已开展活动 H1:L1
    { s: { r: 1, c: 7 }, e: { r: 1, c: 11 } },
  ];

  // ===== 列宽 =====
  const cols = [
    { wch: 6 },   // A 序号
    { wch: 8 },   // B 省份
    { wch: 14 },  // C 活动时间
    { wch: 28 },  // D 活动名称
    { wch: 22 },  // E 活动地点
    { wch: 22 },  // F 主承办单位
    { wch: 40 },  // G 活动简介
    { wch: 28 },  // H 新闻标题
    { wch: 14 },  // I 推送时间
    { wch: 14 },  // J 推送平台
    { wch: 40 },  // K 报道链接
    { wch: 40 },  // L 活动摘要
  ];

  const ws = xlsx.utils.aoa_to_sheet(rows);
  ws['!merges'] = merges;
  ws['!cols'] = cols;

  return ws;
}

// ==================== 导出主函数 ====================

export async function exportToExcel(startDate, endDate) {
  const wb = xlsx.utils.book_new();

  const statsSheet = await buildStatsSheet(startDate, endDate);
  xlsx.utils.book_append_sheet(wb, statsSheet, '数据统计');

  const activitiesSheet = await buildActivitiesSheet(startDate, endDate);
  xlsx.utils.book_append_sheet(wb, activitiesSheet, '活动情况');

  return xlsx.write(wb, { bookType: 'xlsx', type: 'buffer' });
}

export async function exportRawData(startDate, endDate) {
  let subs;
  if (useMongo()) {
    const query = { deleted: false };
    const docs = await Submission.find(query).lean();
    subs = docs.map(doc => {
      const obj = { ...doc };
      delete obj._id; delete obj.__v; delete obj.createdAt; delete obj.updatedAt;
      return obj;
    });
  } else {
    const db = getDb();
    subs = db.submissions.filter(s => !s.deleted);
  }

  if (startDate || endDate) {
    subs = subs.filter(sub => {
      const subDateStr = sub.submitted_at ?
        (sub.submitted_at instanceof Date ?
          sub.submitted_at.toISOString().substring(0, 10) :
          String(sub.submitted_at).substring(0, 10)) : '';
      if (startDate && subDateStr < startDate) return false;
      if (endDate && subDateStr > endDate) return false;
      return true;
    });
  }

  const rows = subs.map(sub => ({
    'ID': sub.id,
    '高校名称': sub.school_name || '',
    '填报人': sub.reporter_name || '',
    '职务': sub.reporter_position || '',
    '联系电话': sub.phone || '',
    '邮箱': sub.email || '',
    '统计周期': `${sub.period_start || ''} ~ ${sub.period_end || ''}`,
    '提交时间': formatDate(sub.submitted_at),
    '本周宣讲场次': sub.q8_weekly_lectures || 0,
    '宣讲覆盖人次': sub.q9_weekly_reach || 0,
    '累计宣讲场次': sub.q10_cumul_lectures || 0,
    '累计覆盖人次': sub.q11_cumul_reach || 0,
    '本周招聘场次': sub.q16_weekly_recruit || 0,
    '参与企业数': sub.q17_weekly_companies || 0,
    '提供岗位数': sub.q18_weekly_jobs || 0,
    '政务实习单位': sub.q22_gov_units || 0,
    '政务实习岗位': sub.q23_gov_jobs || 0,
    '政务实习学生': sub.q24_gov_students || 0,
    '企业实习单位': sub.q28_ent_units || 0,
    '企业实习岗位': sub.q29_ent_jobs || 0,
    '企业实习学生': sub.q30_ent_students || 0,
    '职场体验场次': sub.q34_exp_sessions || 0,
    '职场体验人次': sub.q35_exp_reach || 0,
    '新增青春小店': sub.q38_new_shops || 0,
    '累计青春小店': sub.q39_cumul_shops || 0,
    '国赛落地项目': sub.q41_national_landings || 0,
    '省赛落地项目': sub.q43_provincial_landings || 0,
  }));

  const ws = xlsx.utils.json_to_sheet(rows);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, '原始数据');
  return xlsx.write(wb, { bookType: 'xlsx', type: 'buffer' });
}

export async function exportUnsubmittedExcel(weekStart, weekEnd) {
  const schools = await getUnsubmittedSchools(weekStart, weekEnd);

  const rows = schools.map((school, idx) => ({
    '序号': idx + 1,
    '高校名称': school,
    '状态': '未提交',
    '统计周期': `${weekStart || ''} ~ ${weekEnd || ''}`
  }));

  const ws = xlsx.utils.json_to_sheet(rows);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, '未提交高校');
  return xlsx.write(wb, { bookType: 'xlsx', type: 'buffer' });
}

/** 获取未提交高校列表 */
async function getUnsubmittedSchools(weekStart, weekEnd) {
  // 获取已提交学校（过滤软删除）
  let submittedSchools = new Set();

  if (useMongo()) {
    const query = { deleted: false };
    const docs = await Submission.find(query).lean();
    const submissions = docs.map(doc => {
      const obj = { ...doc };
      delete obj._id; delete obj.__v; delete obj.createdAt; delete obj.updatedAt;
      return obj;
    });
    for (const sub of submissions) {
      if (weekStart && weekEnd) {
        if (sub.period_start === weekStart && sub.period_end === weekEnd) {
          submittedSchools.add(sub.school_name);
        }
      } else {
        submittedSchools.add(sub.school_name);
      }
    }
  } else {
    const db = getDb();
    for (const sub of db.submissions) {
      if (sub.deleted) continue;
      if (weekStart && weekEnd) {
        if (sub.period_start === weekStart && sub.period_end === weekEnd) {
          submittedSchools.add(sub.school_name);
        }
      } else {
        submittedSchools.add(sub.school_name);
      }
    }
  }

  // 只统计在SCHOOLS列表中的学校
  const unsubmitted = SCHOOLS.filter(school => !submittedSchools.has(school));
  return unsubmitted;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch (e) {
    return dateStr;
  }
}

import xlsx from 'xlsx';
import { SCHOOLS } from './constants.js';
import { getDb } from './db.js';

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

/** 收集所有非空文本，用分号分隔，最多取 maxItems 条 */
function joinTexts(items, field, maxItems = 3) {
  const texts = items.map(it => it[field]).filter(t => t && String(t).trim()).map(t => String(t).trim());
  if (!texts.length) return '';
  // 取最多 maxItems 条
  const selected = texts.slice(0, maxItems);
  return selected.join('；') + (texts.length > maxItems ? ` 等${texts.length}条` : '');
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
function getLatestSubs(startDate, endDate) {
  const db = getDb();
  const map = new Map();
  for (const sub of db.submissions) {
    // 过滤软删除记录
    if (sub.deleted) continue;
    // 日期过滤
    if (startDate || endDate) {
      const subDate = sub.submitted_at ? sub.submitted_at.substring(0, 10) : '';
      if (startDate && subDate < startDate) continue;
      if (endDate && subDate > endDate) continue;
    }
    const existing = map.get(sub.school_name);
    if (!existing || new Date(sub.submitted_at) > new Date(existing.submitted_at)) {
      map.set(sub.school_name, sub);
    }
  }
  return Array.from(map.values());
}

/** 筛选指定日期范围内的提交（过滤软删除） */
function getSubsInPeriod(startDate, endDate) {
  const db = getDb();
  return db.submissions.filter(sub => {
    if (sub.deleted) return false;
    return sub.period_start >= startDate && sub.period_end <= endDate;
  });
}

// ==================== Sheet1: 数据统计 ====================

function buildStatsSheet(startDate, endDate) {
  // 取每个学校的最新提交进行汇总（已过滤软删除）
  const subs = getLatestSubs();

  // 当前日期字符串
  const now = new Date();
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;

  // ===== 汇总各项数据 =====

  // --- 省级宣讲 ---
  const provincialDesc = joinTexts(subs, 'q15_provincial_desc') || '—';

  // --- 校级宣讲（累计开展X场，覆盖Y人次）---
  const culLectures = sum(subs, 'q10_cumul_lectures');
  const culReach    = sum(subs, 'q11_cumul_reach');
  const schoolLectureText = (culLectures > 0 || culReach > 0)
    ? `累计开展${culLectures > 0 ? culLectures : '（未填）'}场，覆盖${culReach > 0 ? culReach : '（未填）'}人次`
    : '（未填）';

  // --- 主题团日（累计X场）---
  const culTuanri = sum(subs, 'q14_cumul_tuanri');
  const tuanriText = culTuanri > 0 ? `累计开展${culTuanri}场` : '—';

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
  const companiesText = (wCompanies > 0 || wJobs > 0 || cCompanies > 0 || cJobs > 0)
    ? `本周：参与${wCompanies || 0}家企业，提供${wJobs || 0}个岗位\n累计：参与${cCompanies || 0}家企业，提供${cJobs || 0}个岗位`
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
  const expSessionText = (wExpSessions > 0 || cExpSessions > 0)
    ? `本周${wExpSessions || 0}场；累计${cExpSessions || 0}场`
    : '—';
  const expReachText = (wExpReach > 0 || cExpReach > 0)
    ? `本周${wExpReach || 0}人；累计${cExpReach || 0}人`
    : '—';

  // --- 青春小店：高校 ---
  const newShops      = sum(subs, 'q38_new_shops');
  const culShops      = sum(subs, 'q39_cumul_shops');
  const culShopStu    = sum(subs, 'q40_cumul_students');
  const campusShopText = (newShops > 0 || culShops > 0 || culShopStu > 0)
    ? `本周新增${newShops || 0}个；累计${culShops || 0}个；带动就业${culShopStu || 0}人`
    : '—';

  // --- 青春小店：城市 ---
  const cityShopText = joinTexts(subs, 'q45_city_shops_desc') || '—';

  // --- 国赛获奖项目 ---
  const nLand   = sum(subs, 'q41_national_landings');
  const nComp   = sum(subs, 'q41_national_companies');
  const nTalent = sum(subs, 'q41_national_talents');
  const nFund   = sum(subs, 'q41_national_funds');
  const nDesc   = joinTexts(subs, 'q42_national_desc');
  const nationalText = buildCompetitionText(nLand, nComp, nTalent, nFund, nDesc);

  // --- 省赛获奖项目 ---
  const pLand   = sum(subs, 'q43_provincial_landings');
  const pComp   = sum(subs, 'q43_provincial_companies');
  const pTalent = sum(subs, 'q43_provincial_talents');
  const pFund   = sum(subs, 'q43_provincial_funds');
  const pDesc   = joinTexts(subs, 'q44_provincial_desc');
  const provincialText = buildCompetitionText(pLand, pComp, pTalent, pFund, pDesc);

  // --- 调研工作：收集所有调研条目 ---
  const researchList = [];
  const publicityList = [];
  for (const sub of subs) {
    for (const item of sub.research_items || []) {
      if (item.name) researchList.push(`【${sub.school_name}】${item.name}`);
    }
    for (const item of sub.publicity_items || []) {
      const activity = item.activityName || item.name || '';
      if (activity) publicityList.push(`【${sub.school_name}】${activity}`);
    }
  }

  // ===== 构建二维数组数据 =====
  // 所有单元格必须填充，合并区域只需在左上角单元格放值，其余放空字符串

  const rows = [];

  // Row 0: 标题
  rows.push(['2026年大学生就业服务工作信息统计表', '', '', '', '']);

  // Row 1: 省份+日期
  rows.push([`省份：上海    数据截至：${dateStr}`, '', '', '', '']);

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
    '各级团组织主办、联系的招聘活动及各级团组织联系的招聘岗位归集情况',
    '',
    '',
    ''
  ]);
  rows.push(['', '场次', '', '参与企业数量\n（其中提供就业岗位数量）', '']);
  rows.push(['', recruitText, '', companiesText, '']);

  // ---- Rows 9-11: 大学生就业实习/扬帆计划 ----
  rows.push([
    "大学生就业实习\n'扬帆计划'",
    '大学生就业实习岗位开发及实习学生上岗情况',
    '',
    '大学生职场体验活动情况',
    ''
  ]);
  rows.push(['', '政务实习情况', '企业实习情况', '场次', '覆盖规模']);
  rows.push(['', govText, entText, expSessionText, expReachText]);

  // ---- Rows 12-14: 创业带动就业 ----
  rows.push(['创业带动就业*', '青春小店情况', '', '成果孵化转化情况', '']);
  rows.push(['', '高校青春小店', '城市青春小店', '国赛获奖项目', '省赛获奖项目']);
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
    '备注：\n1.“创业带动就业”为选填项；\n2.请于每周五12:00前提交本周工作信息。',
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
    { s: { r: 2, c: 0 }, e: { r: 2, c: 1 } },

    // --- 大学生就业引航计划 ---
    { s: { r: 3, c: 0 }, e: { r: 5, c: 0 } },   // A4:A6
    { s: { r: 3, c: 3 }, e: { r: 3, c: 4 } },   // D4:E4
    { s: { r: 4, c: 1 }, e: { r: 4, c: 2 } },   // B5:C5
    { s: { r: 4, c: 3 }, e: { r: 4, c: 4 } },   // D5:E5

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

    // --- 其他有关工作 ---
    { s: { r: 15, c: 0 }, e: { r: 17, c: 0 } }, // A16:A18
    { s: { r: 15, c: 1 }, e: { r: 15, c: 2 } }, // B16:C16
    { s: { r: 15, c: 3 }, e: { r: 15, c: 4 } }, // D16:E16

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
  if (companies > 0) parts.push(`引入${companies}家企业`);
  if (talents > 0) parts.push(`引入${talents}名人才`);
  if (funds > 0) parts.push(`引入${funds}万元资金`);

  let text = parts.length ? parts.join('，') : '（未填）';
  if (desc) {
    text += '\n' + desc;
  }
  return text;
}


// ==================== Sheet2: 活动情况 ====================

function buildActivitiesSheet(startDate, endDate) {
  const db = getDb();
  const rows = [];

  // Row 0: 标题
  rows.push(['2026年大学生就业服务工作活动情况统计表', '', '', '', '', '', '', '', '', '', '', '']);

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
  let submissions = db.submissions.filter(s => !s.deleted);
  if (startDate || endDate) {
    submissions = submissions.filter(sub => {
      const subDate = sub.submitted_at ? sub.submitted_at.substring(0, 10) : '';
      if (startDate && subDate < startDate) return false;
      if (endDate && subDate > endDate) return false;
      return true;
    });
  }

  // 遍历过滤后的提交，按学校分组，将拟开展和已开展配对放在同一行
  let seq = 1;

  for (const sub of submissions) {
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
        p.date || p.activity_date || '',          // C 活动时间
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

  // 如果没有数据，加一行提示
  if (rows.length <= 3) {
    rows.push(['', '', '', '', '', '', '', '', '', '', '', '暂无数据']);
  }

  // ===== 合并单元格 (0-based) =====
  const merges = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 11 } },  // A1:L1 标题
    { s: { r: 1, c: 0 }, e: { r: 2, c: 0 } },   // A2:A3 序号
    { s: { r: 1, c: 1 }, e: { r: 2, c: 1 } },   // B2:B3 省份
    { s: { r: 1, c: 2 }, e: { r: 1, c: 6 } },   // C2:G2 拟开展活动
    { s: { r: 1, c: 7 }, e: { r: 1, c: 11 } },  // H2:L2 已开展活动
  ];

  // ===== 列宽 =====
  const cols = [
    { wch: 6 },   // A 序号
    { wch: 10 },  // B 省份
    { wch: 14 },  // C 活动时间
    { wch: 28 },  // D 活动名称
    { wch: 20 },  // E 活动地点
    { wch: 20 },  // F 主承办单位
    { wch: 36 },  // G 活动简介
    { wch: 28 },  // H 新闻标题
    { wch: 14 },  // I 推送时间
    { wch: 14 },  // J 推送平台
    { wch: 30 },  // K 报道链接
    { wch: 36 },  // L 活动摘要
  ];

  const ws = xlsx.utils.aoa_to_sheet(rows);
  ws['!merges'] = merges;
  ws['!cols'] = cols;

  return ws;
}


// ==================== 主导出函数 ====================

/**
 * 导出数据统计 + 活动情况 Excel
 * @param {string} startDate - 开始日期 (YYYY-MM-DD)
 * @param {string} endDate - 结束日期 (YYYY-MM-DD)
 * @returns {Buffer} Excel 文件 Buffer
 */
export function exportToExcel(startDate, endDate) {
  const statsSheet = buildStatsSheet(startDate, endDate);
  const activitiesSheet = buildActivitiesSheet(startDate, endDate);

  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, statsSheet, '数据统计');
  xlsx.utils.book_append_sheet(wb, activitiesSheet, '活动情况');

  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}


// ==================== 未提交高校导出 ====================

/**
 * 导出本周未提交周报的高校清单（优化版）
 * @param {string} weekStart - 本周开始日期
 * @param {string} weekEnd - 本周结束日期
 * @param {string[]} unsubmittedList - 可选，外部传入的未提交高校列表（与stats一致）
 * @returns {Buffer} Excel 文件 Buffer
 */

// 原始数据导出：不做聚合，每条记录完整导出（过滤软删除）
export function exportRawData(startDate, endDate) {
  const db = getDb();
  // 过滤软删除记录
  let subs = db.submissions.filter(s => !s.deleted);

  // 日期过滤
  if (startDate) {
    subs = subs.filter(s => s.submitted_at && s.submitted_at.substring(0, 10) >= startDate);
  }
  if (endDate) {
    subs = subs.filter(s => s.submitted_at && s.submitted_at.substring(0, 10) <= endDate);
  }

  // 所有字段作为列
  const headers = [
    'ID', '高校名称', '填报人', '职务', '电话', '邮箱',
    '周期开始', '周期结束', '提交时间',
    '本周宣讲场次', '本周宣讲人次', '累计宣讲场次', '累计宣讲人次', '是否已开展引航', '本周团日场次', '累计团日场次', '省级宣讲',
    '本周招聘场次', '本周企业数', '本周岗位数', '累计招聘场次', '累计企业数', '累计岗位数',
    '政务实习本周单位', '政务实习本周岗位', '政务实习本周学生', '政务实习累计单位', '政务实习累计岗位', '政务实习累计学生',
    '企业实习本周单位', '企业实习本周岗位', '企业实习本周学生', '企业实习累计单位', '企业实习累计岗位', '企业实习累计学生',
    '职场体验本周场次', '职场体验本周人次', '职场体验累计场次', '职场体验累计人次',
    '本周新增青春小店', '累计青春小店', '累计创业学生',
    '国赛落地数', '国赛企业数', '国赛人才数', '国赛资金(万元)', '国赛描述',
    '省赛落地数', '省赛企业数', '省赛人才数', '省赛资金(万元)', '省赛描述',
    '城市青春小店',
    '是否有调研', '是否有宣传',
    '调研条目数', '宣传条目数', '拟开展活动数', '已开展活动数'
  ];

  const rows = subs.map(s => [
    s.id, s.school_name, s.reporter_name, s.reporter_position, s.phone, s.email,
    s.period_start, s.period_end, s.submitted_at,
    s.q8_weekly_lectures, s.q9_weekly_reach, s.q10_cumul_lectures, s.q11_cumul_reach, s.q12_has_lecture, s.q13_weekly_tuanri, s.q14_cumul_tuanri, s.q15_provincial_desc,
    s.q16_weekly_recruit, s.q17_weekly_companies, s.q18_weekly_jobs, s.q19_cumul_recruit, s.q20_cumul_companies, s.q21_cumul_jobs,
    s.q22_gov_units, s.q23_gov_jobs, s.q24_gov_students, s.q25_cumul_gov_units, s.q26_cumul_gov_jobs, s.q27_cumul_gov_students,
    s.q28_ent_units, s.q29_ent_jobs, s.q30_ent_students, s.q31_cumul_ent_units, s.q32_cumul_ent_jobs, s.q33_cumul_ent_students,
    s.q34_exp_sessions, s.q35_exp_reach, s.q36_cumul_exp_sessions, s.q37_cumul_exp_reach,
    s.q38_new_shops, s.q39_cumul_shops, s.q40_cumul_students,
    s.q41_national_landings, s.q41_national_companies, s.q41_national_talents, s.q41_national_funds, s.q42_national_desc,
    s.q43_provincial_landings, s.q43_provincial_companies, s.q43_provincial_talents, s.q43_provincial_funds, s.q44_provincial_desc,
    s.q45_city_shops_desc,
    s.q46_has_research, s.q48_has_publicity,
    (s.research_items || []).length, (s.publicity_items || []).length,
    (s.planned_activities || []).length, (s.completed_activities || []).length
  ]);

  const ws = xlsx.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [
    { wch: 6 }, { wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 22 },
    { wch: 12 }, { wch: 12 }, { wch: 20 },
    ...Array(44).fill({ wch: 12 })
  ];

  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, '原始数据');
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}


export function exportUnsubmittedExcel(weekStart, weekEnd, unsubmittedList = null) {
  const db = getDb();

  let unsubmitted;
  if (unsubmittedList && Array.isArray(unsubmittedList)) {
    // 使用外部传入的列表（与 stats 接口一致的全局去重逻辑）
    unsubmitted = unsubmittedList;
  } else {
    // 找出本周已提交的高校（排除软删除）
    const submittedSchools = new Set();
    for (const sub of db.submissions) {
      if (sub.deleted) continue;
      if (sub.period_start === weekStart && sub.period_end === weekEnd) {
        submittedSchools.add(sub.school_name);
      }
    }
    // 未提交的高校列表
    unsubmitted = SCHOOLS.filter(s => !submittedSchools.has(s));
  }
  const total = SCHOOLS.length;
  const count = unsubmitted.length;

  // 当前时间
  const now = new Date();
  const timeStr = now.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });

  // ===== 构建 Sheet 数据 =====
  const rows = [];

  // Row 0: 标题
  rows.push(['本周未提交周报高校清单', '', '', '', '']);

  // Row 1: 统计周期
  rows.push(['统计周期', `${weekStart} 至 ${weekEnd}`, '', '', '']);

  // Row 2: 生成时间
  rows.push(['生成时间', timeStr, '', '', '']);

  // Row 3: 未提交数
  rows.push(['未提交数', `${count} / ${total}`, '', '', '']);

  // Row 4: 空行
  rows.push(['', '', '', '', '']);

  // Row 5: 表头
  rows.push(['序号', '高校名称', '联系人', '联系电话', '备注']);

  // 数据行
  unsubmitted.forEach((school, i) => {
    rows.push([i + 1, school, '', '', '']);
  });

  // ===== 合并单元格 =====
  const merges = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },  // A1:F1 标题
    { s: { r: 1, c: 1 }, e: { r: 1, c: 4 } },  // B2:E2 统计周期值
    { s: { r: 2, c: 1 }, e: { r: 2, c: 4 } },  // B3:E3 生成时间值
    { s: { r: 3, c: 1 }, e: { r: 3, c: 4 } },  // B4:E4 未提交数值
  ];

  // ===== 列宽 =====
  const cols = [
    { wch: 8 },   // A 序号
    { wch: 32 },  // B 高校名称
    { wch: 14 },  // C 联系人
    { wch: 16 },  // D 联系电话
    { wch: 16 },  // E 备注
  ];

  const ws = xlsx.utils.aoa_to_sheet(rows);
  ws['!merges'] = merges;
  ws['!cols'] = cols;

  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, '未提交高校');

  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

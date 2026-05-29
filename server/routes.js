import express from 'express';
import jwt from 'jsonwebtoken';
import { getDb, saveData, getNextId, useMongo, logAudit } from './db.js';
import { authenticate, JWT_SECRET } from './auth.js';
import { exportToExcel, exportUnsubmittedExcel, exportRawData } from './export.js';
import { SCHOOLS } from './constants.js';
import { Submission, Admin, AuditLog } from './db.js';

const router = express.Router();

// ========== 登录限流 ==========
const loginAttempts = new Map(); // ip -> {count, lastAttempt}
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15分钟

/** 从请求中获取客户端真实IP（支持 Render 等代理环境的 x-forwarded-for） */
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress;
}

function checkLoginLimit(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record) return true;
  if (record.count >= MAX_LOGIN_ATTEMPTS) {
    if (now - record.lastAttempt < LOGIN_LOCKOUT_MS) {
      return { allowed: false, message: '登录尝试过多，请稍后再试' };
    }
    // 锁定期已过，重置
    loginAttempts.delete(ip);
    return true;
  }
  return true;
}

function recordLoginAttempt(ip, success) {
  if (success) {
    loginAttempts.delete(ip);
    return;
  }
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record) {
    loginAttempts.set(ip, { count: 1, lastAttempt: now });
  } else {
    record.count++;
    record.lastAttempt = now;
  }
}

const SQL_KEYWORDS = ['DROP', 'TABLE', 'DELETE', 'INSERT', 'UPDATE', 'SELECT', 'UNION', 'EXEC', 'SCRIPT', 'ALTER', 'CREATE', 'TRUNCATE'];
function sanitizeSql(text) {
  if (!text || typeof text !== 'string') return text;
  let result = text;
  for (const keyword of SQL_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    result = result.replace(regex, `[${keyword}]`);
  }
  return result;
}

function capPageSize(val) {
  const n = parseInt(val, 10);
  if (isNaN(n) || n < 1) return 10;
  return Math.min(n, 100);
}

// ========== XSS 转义（仅用于后端回显输出，不入库） ==========
function escapeHtml(str) {
  if (str === null || str === undefined) return str;
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** trim + SQL sanitize —— 入库前处理，避免触发 Cloudflare WAF */
function cleanString(val) {
  if (val === null || val === undefined) return '';
  return sanitizeSql(String(val).trim());
}

/** 安全解析数字，无效或负数时返回 0（默认最小值为0） */
function num(val, min = 0) {
  const n = Number(val);
  if (isNaN(n)) return 0;
  return Math.max(min, n);
}

/** 解析累计字段：空/null/undefined/负数时保留 null，否则返回数字 */
function numOrNull(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  if (isNaN(n)) return null;
  if (n < 0) return null; // 负数视为无效
  return n;
}

// ========== 请求体验证 ==========
function validateBody(body) {
  const errors = [];
  // 高校名称
  if (!body.university?.trim()) {
    errors.push('高校名称必填');
  } else if (!SCHOOLS.includes(body.university) && body.university !== '__OTHER__') {
    errors.push('高校名称无效');
  }
  // 填报人姓名
  if (!body.reporterName?.trim()) {
    errors.push('填报人姓名必填');
  } else if (body.reporterName.trim().length > 20) {
    errors.push('填报人姓名长度不能超过20个字符');
  }
  // 填报人职务
  if (!body.reporterPosition?.trim()) {
    errors.push('填报人职务必填');
  }
  // 联系电话
  if (!body.phone || !/^1\d{10}$/.test(body.phone)) {
    errors.push('联系电话格式错误，应为11位手机号');
  }
  // 邮箱
  if (!body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    errors.push('邮箱格式错误');
  }
  // 统计周期
  if (!body.periodStart) {
    errors.push('统计周期开始日必填');
  }
  if (!body.periodEnd) {
    errors.push('统计周期结束日必填');
  }
  // 模块数据
  if (!body.module1) {
    errors.push('就业引航计划数据缺失');
  }
  if (!body.module2) {
    errors.push('千校万岗数据缺失');
  }
  if (!body.module3) {
    errors.push('扬帆计划数据缺失');
  }
  if (!body.module4) {
    errors.push('创业带动就业数据缺失');
  }

  // 日期格式和顺序校验
  const dateRe = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  if (body.periodStart && !dateRe.test(body.periodStart)) errors.push('统计周期开始日格式错误（应为YYYY-MM-DD）');
  if (body.periodEnd && !dateRe.test(body.periodEnd)) errors.push('统计周期结束日格式错误（应为YYYY-MM-DD）');
  if (body.periodStart && body.periodEnd && dateRe.test(body.periodStart) && dateRe.test(body.periodEnd) && body.periodStart > body.periodEnd) errors.push('统计周期开始日不能晚于结束日');

  // 字段长度限制
  const m1 = body.module1 || {};
  const m2 = body.module2 || {};
  const m4 = body.module4 || {};
  if (m1.provinceLecture && String(m1.provinceLecture).length > 500) errors.push('省级宣讲描述不能超过500字');
  if (m4.nat?.desc && String(m4.nat.desc).length > 500) errors.push('国赛孵化描述不能超过500字');
  if (m4.prov?.desc && String(m4.prov.desc).length > 500) errors.push('省赛孵化描述不能超过500字');
  if (m4.cityShop && String(m4.cityShop).length > 500) errors.push('城市青春小店描述不能超过500字');
  const m5 = body.module5 || {};
  if (m5.research) {
    for (let i = 0; i < m5.research.length; i++) {
      if (m5.research[i].name && String(m5.research[i].name).length > 100) errors.push(`调研${i+1}名称超过100字`);
    }
  }

  // 数值范围校验：显式报错而非静默归零
  const checkNum = (val, name, max = 1000000000000) => {
    if (val === null || val === undefined || val === '') return;
    const n = Number(val);
    if (isNaN(n)) errors.push(`${name}不是有效数字`);
    else if (n < 0) errors.push(`${name}不能为负数`);
    else if (n > max) errors.push(`${name}超过上限${max}`);
  };
  checkNum(m1.lectureNew, '本周新增宣讲场次', 10000);
  checkNum(m1.lectureCover, '本周宣讲覆盖人次', 10000000);
  checkNum(m1.themeDayNew, '本周新增主题团日场次', 10000);
  checkNum(m2.recruitNew, '本周新增招聘场次', 10000);
  checkNum(m2.enterpriseNew, '本周参与企业数量', 100000);
  checkNum(m2.jobsNew, '本周提供就业岗位数量', 10000000);
  const m3 = body.module3 || {};
  checkNum(m3.gov?.unitNew, '政务实习本周新增单位数', 10000);
  checkNum(m3.gov?.postNew, '政务实习本周新增岗位数', 100000);
  checkNum(m3.gov?.studentNew, '政务实习本周参与学生数', 100000);
  checkNum(m3.enterprise?.unitNew, '企业实习本周新增单位数', 10000);
  checkNum(m3.enterprise?.postNew, '企业实习本周新增岗位数', 100000);
  checkNum(m3.enterprise?.studentNew, '企业实习本周参与学生数', 100000);
  checkNum(m3.work?.eventNew, '职场体验本周新增场次', 10000);
  checkNum(m3.work?.coverNew, '职场体验本周覆盖人次', 10000000);
  checkNum(m4.shopNew, '本周新增青春小店数量', 10000);
  checkNum(m4.national?.fund, '国赛配套支持资金', 1000000000000);
  checkNum(m4.provincial?.fund, '省赛配套支持资金', 1000000000000);

  return errors.length ? errors : null;
}

// ========== 字段映射：前端嵌套结构 → 后端扁平字段 ==========
function mapSubmission(body) {
  // === 基础信息 ===
  const schoolName = cleanString(body.university || body.schoolName || '');
  const reporterName = cleanString(body.reporterName || '');
  const reporterPosition = cleanString(body.reporterPosition || '');
  const phone = cleanString(body.phone || '');
  const email = cleanString(body.email || '');
  const periodStart = cleanString(body.periodStart || '');
  const periodEnd = cleanString(body.periodEnd || '');
  const deadline = cleanString(body.dataDeadline || body.deadline || '');

  // === 模块I: 就业引航计划 ===
  const m1 = body.module1 || {};
  const q8_weekly_lectures = num(m1.lectureNew);
  const q9_weekly_reach = num(m1.lectureCover);
  const q10_cumul_lectures = numOrNull(m1.lectureTotal);
  const q11_cumul_reach = numOrNull(m1.lectureTotalCover);
  const q12_has_lecture = m1.hasLecture === true || m1.hasLecture === 'yes' ? '是' :
                          (m1.hasLecture === false || m1.hasLecture === 'no' ? '否' : '');
  const q13_weekly_tuanri = num(m1.themeDayNew);
  const q14_cumul_tuanri = numOrNull(m1.themeDayTotal);
  const q15_provincial_desc = cleanString(m1.provinceLecture);

  // === 模块II: 千校万岗 ===
  const m2 = body.module2 || {};
  const q16_weekly_recruit = num(m2.recruitNew);
  const q17_weekly_companies = num(m2.enterpriseNew);
  const q18_weekly_jobs = num(m2.jobsNew);
  const q19_cumul_recruit = numOrNull(m2.recruitTotal);
  const q20_cumul_companies = numOrNull(m2.enterpriseTotal);
  const q21_cumul_jobs = numOrNull(m2.jobsTotal);

  // === 模块III: 扬帆计划 - 政务实习 ===
  const m3 = body.module3 || {};
  const m3gov = m3.gov || {};
  const q22_gov_units = num(m3gov.unitNew);
  const q23_gov_jobs = num(m3gov.postNew);
  const q24_gov_students = num(m3gov.studentNew);
  const q25_cumul_gov_units = numOrNull(m3gov.unitTotal);
  const q26_cumul_gov_jobs = numOrNull(m3gov.postTotal);
  const q27_cumul_gov_students = numOrNull(m3gov.studentTotal);

  // === 模块III: 企业实习 ===
  const m3ent = m3.enterprise || {};
  const q28_ent_units = num(m3ent.unitNew);
  const q29_ent_jobs = num(m3ent.postNew);
  const q30_ent_students = num(m3ent.studentNew);
  const q31_cumul_ent_units = numOrNull(m3ent.unitTotal);
  const q32_cumul_ent_jobs = numOrNull(m3ent.postTotal);
  const q33_cumul_ent_students = numOrNull(m3ent.studentTotal);

  // === 模块III: 职场体验 ===
  const m3work = m3.work || {};
  const q34_exp_sessions = num(m3work.eventNew);
  const q35_exp_reach = num(m3work.coverNew);
  const q36_cumul_exp_sessions = numOrNull(m3work.eventTotal);
  const q37_cumul_exp_reach = numOrNull(m3work.coverTotal);

  // === 模块IV: 创业带动就业 ===
  const m4 = body.module4 || {};
  const q38_new_shops = num(m4.shopNew);
  const q39_cumul_shops = numOrNull(m4.shopTotal);
  const q40_cumul_students = numOrNull(m4.startupStudents);

  const m4nat = m4.national || {};
  const q41_national_landings = num(m4nat.project);
  const q41_national_companies = num(m4nat.company);
  const q41_national_talents = num(m4nat.talent);
  const q41_national_funds = Math.round(num(m4nat.fund) * 100) / 100;
  const q42_national_desc = cleanString(m4nat.desc);

  const m4prov = m4.provincial || {};
  const q43_provincial_landings = num(m4prov.project);
  const q43_provincial_companies = num(m4prov.company);
  const q43_provincial_talents = num(m4prov.talent);
  const q43_provincial_funds = Math.round(num(m4prov.fund) * 100) / 100;
  const q44_provincial_desc = cleanString(m4prov.desc);

  const q45_city_shops_desc = cleanString(m4.cityShop);

  // === 模块V: 其他工作 ===
  const m5 = body.module5 || {};
  const q46_has_research = m5.hasResearch === true || m5.hasResearch === 'yes' ? '有' :
                           (m5.hasResearch === false || m5.hasResearch === 'no' ? '无' : '');
  const q48_has_publicity = m5.hasPublicity === true || m5.hasPublicity === 'yes' ? '有' :
                            (m5.hasPublicity === false || m5.hasPublicity === 'no' ? '无' : '');

  // === 子表: 调研工作 (前端字段名转换) ===
  const research_items = [];
  const rawResearch = m5.research || body.researchItems || body.research || [];
  for (const item of rawResearch) {
    research_items.push({
      id: research_items.length + 1,
      item_date: cleanString(item.date || item.item_date || ''),
      item_name: cleanString(item.name || item.item_name || ''),
      item_org: cleanString(item.org || item.item_org || ''),
      item_result: cleanString(item.result || item.item_result || '')
    });
  }

  // === 子表: 宣传报道 (前端字段名转换) ===
  const publicity_items = [];
  const rawPublicity = m5.publicity || body.publicityItems || body.publicity || [];
  for (const item of rawPublicity) {
    publicity_items.push({
      id: publicity_items.length + 1,
      pub_date: cleanString(item.date || item.pub_date || ''),
      activity_name: cleanString(item.activityName || item.name || item.activity_name || ''),
      media_name: cleanString(item.media || item.media_name || ''),
      link: cleanString(item.url || item.link || ''),
      level: cleanString(item.level || '')
    });
  }

  // === 子表: 拟开展活动 (前端字段名转换) ===
  const planned_activities = [];
  const rawPlanned = body.plannedActivities || [];
  for (const item of rawPlanned) {
    planned_activities.push({
      id: planned_activities.length + 1,
      activity_date: cleanString(item.date || item.activity_date || ''),
      name: cleanString(item.name || ''),
      location: cleanString(item.location || ''),
      organizer: cleanString(item.organizer || ''),
      description: cleanString(item.intro || item.description || '')
    });
  }

  // === 子表: 已开展活动报道 (前端字段名转换) ===
  // 前端字段名: reports[] { title, date, platform, url, summary }
  // 后端字段名: completed_activities[] { news_title, pub_date, platform, link, summary }
  const completed_activities = [];
  const rawReports = body.reports || body.completedActivities || [];
  for (const item of rawReports) {
    completed_activities.push({
      id: completed_activities.length + 1,
      news_title: cleanString(item.title || item.news_title || ''),
      pub_date: cleanString(item.date || item.pub_date || ''),
      platform: cleanString(item.platform || ''),
      link: cleanString(item.url || item.link || ''),
      summary: cleanString(item.summary || '')
    });
  }

  return {
    id: getNextId(),
    school_name: schoolName,
    reporter_name: reporterName,
    reporter_position: reporterPosition,
    phone,
    email,
    period_start: periodStart,
    period_end: periodEnd,
    deadline,
    submitted_at: new Date().toISOString(),

    q8_weekly_lectures, q9_weekly_reach, q10_cumul_lectures, q11_cumul_reach,
    q12_has_lecture, q13_weekly_tuanri, q14_cumul_tuanri, q15_provincial_desc,
    q16_weekly_recruit, q17_weekly_companies, q18_weekly_jobs,
    q19_cumul_recruit, q20_cumul_companies, q21_cumul_jobs,
    q22_gov_units, q23_gov_jobs, q24_gov_students,
    q25_cumul_gov_units, q26_cumul_gov_jobs, q27_cumul_gov_students,
    q28_ent_units, q29_ent_jobs, q30_ent_students,
    q31_cumul_ent_units, q32_cumul_ent_jobs, q33_cumul_ent_students,
    q34_exp_sessions, q35_exp_reach, q36_cumul_exp_sessions, q37_cumul_exp_reach,
    q38_new_shops, q39_cumul_shops, q40_cumul_students,
    q41_national_landings, q41_national_companies, q41_national_talents, q41_national_funds,
    q42_national_desc,
    q43_provincial_landings, q43_provincial_companies, q43_provincial_talents, q43_provincial_funds,
    q44_provincial_desc, q45_city_shops_desc,
    q46_has_research, q48_has_publicity,
    research_items, publicity_items, planned_activities, completed_activities
  };
}

// ========== 辅助：对单条记录的文本字段做 XSS 转义（用于管理后台回显） ==========
function escapeSubmissionFields(item) {
  if (!item) return item;
  const textFields = [
    'school_name', 'reporter_name', 'reporter_position', 'phone', 'email',
    'period_start', 'period_end', 'deadline',
    'q12_has_lecture', 'q15_provincial_desc',
    'q42_national_desc', 'q44_provincial_desc', 'q45_city_shops_desc',
    'q46_has_research', 'q48_has_publicity'
  ];
  const escaped = { ...item };
  for (const field of textFields) {
    if (escaped[field] !== undefined && escaped[field] !== null) {
      escaped[field] = escapeHtml(escaped[field]);
    }
  }
  // 子表字段也转义
  if (escaped.research_items) {
    escaped.research_items = escaped.research_items.map(r => ({
      ...r,
      item_date: escapeHtml(r.item_date),
      item_name: escapeHtml(r.item_name),
      item_org: escapeHtml(r.item_org),
      item_result: escapeHtml(r.item_result)
    }));
  }
  if (escaped.publicity_items) {
    escaped.publicity_items = escaped.publicity_items.map(p => ({
      ...p,
      pub_date: escapeHtml(p.pub_date),
      activity_name: escapeHtml(p.activity_name),
      media_name: escapeHtml(p.media_name),
      link: escapeHtml(p.link),
      level: escapeHtml(p.level)
    }));
  }
  if (escaped.planned_activities) {
    escaped.planned_activities = escaped.planned_activities.map(a => ({
      ...a,
      activity_date: escapeHtml(a.activity_date),
      name: escapeHtml(a.name),
      location: escapeHtml(a.location),
      organizer: escapeHtml(a.organizer),
      description: escapeHtml(a.description)
    }));
  }
  if (escaped.completed_activities) {
    escaped.completed_activities = escaped.completed_activities.map(a => ({
      ...a,
      news_title: escapeHtml(a.news_title),
      pub_date: escapeHtml(a.pub_date),
      platform: escapeHtml(a.platform),
      link: escapeHtml(a.link),
      summary: escapeHtml(a.summary)
    }));
  }
  return escaped;
}

// ========== 辅助：获取未提交高校列表（只考虑未删除记录） ==========
function getUnsubmittedSchools() {
  const db = getDb();
  const submittedSchools = [...new Set(
    db.submissions.filter(s => s.school_name && s.school_name.trim() && !s.deleted)
      .map(s => s.school_name.trim())
  )];
  return SCHOOLS.filter(s => !submittedSchools.includes(s));
}

// ========== 辅助：本周日期范围 ==========
function getThisWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { monday: fmt(monday), sunday: fmt(sunday), mondayObj: monday, sundayObj: sunday };
}

// ========== API 路由 ==========

// 提交问卷（带完整校验 + 重复检测更新 + 审计日志）
router.post('/submit', async (req, res) => {
  try {
    const body = req.body;

    // 完整字段校验
    const errors = validateBody(body);
    if (errors) return res.status(400).json({ success: false, errors });

    const db = getDb();
    const mappedData = mapSubmission(body);

    // 从映射结果中提取用于重复检测的字段
    const schoolName = mappedData.school_name;
    const periodStart = mappedData.period_start;
    const periodEnd = mappedData.period_end;

    // 校验 period 合法性
    if (!periodStart || !periodEnd || !/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
      return res.status(400).json({ success: false, message: '统计周期格式不合法，无法判断重复提交' });
    }

    // 查找同一高校+同一周期的已有记录（只查未删除的）
    const existingIndex = db.submissions.findIndex(s =>
      s.school_name === schoolName &&
      s.period_start === periodStart &&
      s.period_end === periodEnd &&
      !s.deleted
    );

    let message;
    let action;
    if (existingIndex !== -1) {
      // 更新：保留原有 id
      const existingId = db.submissions[existingIndex].id;
      mappedData.id = existingId;
      db.submissions[existingIndex] = mappedData;
      message = '更新成功';
      action = 'UPDATE';
    } else {
      // 新增（id 已在 mapSubmission 中生成）
      db.submissions.push(mappedData);
      message = '提交成功';
      action = 'CREATE';
    }

    saveData();

    // MongoDB模式下同时保存到MongoDB
    if (useMongo()) {
      try {
        await Submission.findOneAndUpdate(
          { id: mappedData.id },
          mappedData,
          { upsert: true, new: true }
        );
      } catch (e) {
        console.error('MongoDB save failed:', e.message);
      }
    }

    // 审计日志（不阻塞主流程）
    logAudit({
      action,
      user: 'anonymous',
      target_id: mappedData.id,
      target_type: 'submission',
      details: { school_name: schoolName, period_start: periodStart, period_end: periodEnd },
      ip: req.ip || req.socket.remoteAddress
    }).catch(() => {});

    res.json({ success: true, id: mappedData.id, message });
  } catch (err) {
    console.error('Submit error:', err);
    res.status(500).json({ success: false, message: '提交失败: ' + err.message });
  }
});

// 管理员登录（带限流 + 审计日志）
router.post('/admin/login', async (req, res) => {
  try {
    const clientIp = getClientIp(req);
    const limitCheck = checkLoginLimit(clientIp);
    if (limitCheck && limitCheck.allowed === false) {
      return res.status(429).json({ success: false, message: limitCheck.message });
    }

    const { username, password } = req.body;
    const db = getDb();
    const admin = db.admins.find(a => a.username === username);

    if (!admin) {
      recordLoginAttempt(clientIp, false);
      logAudit({ action: 'LOGIN', user: username, details: { result: 'failed', reason: 'user_not_found' }, ip: clientIp }).catch(() => {});
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }

    const bcryptModule = await import('bcryptjs');
    const bcrypt = bcryptModule.default || bcryptModule;
    if (!bcrypt.compareSync(password, admin.password)) {
      recordLoginAttempt(clientIp, false);
      logAudit({ action: 'LOGIN', user: username, details: { result: 'failed', reason: 'wrong_password' }, ip: clientIp }).catch(() => {});
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }

    recordLoginAttempt(clientIp, true);
    const token = jwt.sign({ id: admin.id, username }, JWT_SECRET, { expiresIn: '24h' });

    // 审计日志
    logAudit({ action: 'LOGIN', user: username, details: { result: 'success' }, ip: clientIp }).catch(() => {});

    res.json({ success: true, token });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 统计概览（排除软删除记录）
router.get('/admin/stats', authenticate, (req, res) => {
  try {
    const db = getDb();
    const { monday, sunday, mondayObj } = getThisWeekRange();
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    // 只统计未删除的提交
    const activeSubmissions = db.submissions.filter(s => !s.deleted);

    // 本周提交：基于 submitted_at 的日期部分比较
    const thisWeekSubs = activeSubmissions.filter(s => {
      const subDate = s.submitted_at ? s.submitted_at.substring(0, 10) : '';
      return subDate >= monday && subDate <= sunday;
    });

    // 所有已提交的高校名（去重，只考虑未删除）
    const submittedSchools = [...new Set(
      activeSubmissions.filter(s => s.school_name && s.school_name.trim()).map(s => s.school_name.trim())
    )];

    // 未提交高校
    const unsubmitted = SCHOOLS.filter(s => !submittedSchools.includes(s));

    // 计算最近7周趋势
    const weeklyTrend = [];
    for (let i = 6; i >= 0; i--) {
      const weekStart = new Date(mondayObj);
      weekStart.setDate(weekStart.getDate() - i * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);

      const ws = fmt(weekStart);
      const we = fmt(weekEnd);

      const count = activeSubmissions.filter(s => {
        const subDate = s.submitted_at ? s.submitted_at.substring(0, 10) : '';
        return subDate >= ws && subDate <= we;
      }).length;

      weeklyTrend.push({
        label: weekStart.getMonth() + 1 + '/' + weekStart.getDate() + '-' + (weekEnd.getMonth() + 1) + '/' + weekEnd.getDate(),
        count
      });
    }

    res.json({
      success: true,
      data: {
        totalSubmissions: activeSubmissions.length,
        thisWeekSubmissions: thisWeekSubs.length,
        thisWeekStart: monday,
        thisWeekEnd: sunday,
        totalSchools: SCHOOLS.length,
        submittedSchools: submittedSchools.length,
        coverageRate: submittedSchools.length / SCHOOLS.length,
        unsubmittedSchools: unsubmitted,
        schoolSubmissionList: submittedSchools,
        weeklyTrend
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 提交列表（排除软删除记录）
router.get('/admin/submissions', authenticate, (req, res) => {
  try {
    const db = getDb();
    const page = parseInt(req.query.page) || 1;
    const pageSize = capPageSize(req.query.pageSize);

    // 只显示未删除的记录
    let list = db.submissions.filter(s => !s.deleted).sort((a, b) => b.id - a.id);

    if (req.query.school) {
      list = list.filter(s => s.school_name && s.school_name.includes(req.query.school));
    }
    if (req.query.startDate) {
      list = list.filter(s => {
        const subDate = s.submitted_at ? s.submitted_at.substring(0, 10) : '';
        return subDate >= req.query.startDate;
      });
    }
    if (req.query.endDate) {
      list = list.filter(s => {
        const subDate = s.submitted_at ? s.submitted_at.substring(0, 10) : '';
        return subDate <= req.query.endDate;
      });
    }

    const total = list.length;
    const start = (page - 1) * pageSize;
    const data = list.slice(start, start + pageSize);

    // 管理后台回显时对文本字段做 XSS 转义
    const escapedData = data.map(item => escapeSubmissionFields(item));

    res.json({
      success: true,
      data: escapedData,
      pagination: { page, pageSize, total }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ========== 已删除记录列表（必须在 :id 路由之前定义！）==========
router.get('/admin/submissions/deleted', authenticate, (req, res) => {
  try {
    const db = getDb();
    const page = parseInt(req.query.page) || 1;
    const pageSize = capPageSize(req.query.pageSize);

    let list = db.submissions.filter(s => s.deleted).sort((a, b) => b.id - a.id);

    if (req.query.school) {
      list = list.filter(s => s.school_name && s.school_name.includes(req.query.school));
    }

    const total = list.length;
    const start = (page - 1) * pageSize;
    const data = list.slice(start, start + pageSize).map(item => escapeSubmissionFields(item));

    res.json({
      success: true,
      data,
      pagination: { page, pageSize, total }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 单条详情（排除软删除）
router.get('/admin/submissions/:id', authenticate, (req, res) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    const item = db.submissions.find(s => s.id === id && !s.deleted);
    if (!item) return res.status(404).json({ success: false, message: '记录不存在' });

    // 管理后台回显时对文本字段做 XSS 转义
    const escapedItem = escapeSubmissionFields(item);
    res.json({ success: true, data: escapedItem });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 软删除记录
router.delete('/admin/submissions/:id', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    const item = db.submissions.find(s => s.id === id);

    if (!item) {
      return res.status(404).json({ success: false, message: '记录不存在' });
    }

    item.deleted = true;
    item.deleted_at = new Date().toISOString();
    saveData();

    // MongoDB模式下同步软删除
    if (useMongo()) {
      try {
        await Submission.findOneAndUpdate(
          { id },
          { deleted: true, deleted_at: item.deleted_at }
        );
      } catch (e) {
        console.error('MongoDB soft delete failed:', e.message);
      }
    }

    // 审计日志
    logAudit({
      action: 'DELETE',
      user: req.admin?.username,
      target_id: id,
      target_type: 'submission',
      details: { school_name: item.school_name, period_start: item.period_start, period_end: item.period_end },
      ip: req.ip || req.socket.remoteAddress
    }).catch(() => {});

    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ========== 新增：恢复软删除记录 ==========
router.post('/admin/submissions/:id/restore', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    const item = db.submissions.find(s => s.id === id);

    if (!item) {
      return res.status(404).json({ success: false, message: '记录不存在' });
    }
    if (!item.deleted) {
      return res.status(400).json({ success: false, message: '记录未删除，无需恢复' });
    }

    item.deleted = false;
    item.deleted_at = null;
    saveData();

    if (useMongo()) {
      try {
        await Submission.findOneAndUpdate(
          { id },
          { deleted: false, deleted_at: null }
        );
      } catch (e) {
        console.error('MongoDB restore failed:', e.message);
      }
    }

    logAudit({
      action: 'RESTORE',
      user: req.admin?.username,
      target_id: id,
      target_type: 'submission',
      details: { school_name: item.school_name },
      ip: req.ip || req.socket.remoteAddress
    }).catch(() => {});

    res.json({ success: true, message: '恢复成功' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ========== 新增：永久删除记录 ==========
router.delete('/admin/submissions/:id/permanent', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    const item = db.submissions.find(s => s.id === id);

    if (!item) {
      return res.status(404).json({ success: false, message: '记录不存在' });
    }

    db.submissions = db.submissions.filter(s => s.id !== id);
    saveData();

    if (useMongo()) {
      try {
        await Submission.deleteOne({ id });
      } catch (e) {
        console.error('MongoDB permanent delete failed:', e.message);
      }
    }

    logAudit({
      action: 'PERMANENT_DELETE',
      user: req.admin?.username,
      target_id: id,
      target_type: 'submission',
      details: { school_name: item.school_name },
      ip: req.ip || req.socket.remoteAddress
    }).catch(() => {});

    res.json({ success: true, message: '永久删除成功' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ========== 新增：修改密码 ==========
router.post('/admin/password', authenticate, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const username = req.admin?.username;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ success: false, message: '请提供旧密码和新密码' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: '新密码至少6位' });
    }

    const db = getDb();
    const admin = db.admins.find(a => a.username === username);

    if (!admin) {
      return res.status(404).json({ success: false, message: '管理员不存在' });
    }

    const bcryptModule = await import('bcryptjs');
    const bcrypt = bcryptModule.default || bcryptModule;

    if (!bcrypt.compareSync(oldPassword, admin.password)) {
      return res.status(401).json({ success: false, message: '旧密码错误' });
    }

    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    admin.password = hashedPassword;
    saveData();

    // MongoDB模式下同步密码修改
    if (useMongo()) {
      try {
        await Admin.findOneAndUpdate(
          { username },
          { password: hashedPassword }
        );
      } catch (e) {
        console.error('MongoDB password update failed:', e.message);
      }
    }

    // 审计日志
    logAudit({
      action: 'PASSWORD_CHANGE',
      user: username,
      details: { result: 'success' },
      ip: req.ip || req.socket.remoteAddress
    }).catch(() => {});

    res.json({ success: true, message: '密码修改成功' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ========== 新增：批量导入 ==========
router.post('/admin/import', authenticate, async (req, res) => {
  try {
    const items = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ success: false, message: '请求体应为JSON数组' });
    }

    const stats = { total: items.length, success: 0, failed: 0, errors: [] };

    for (let i = 0; i < items.length; i++) {
      const body = items[i];
      const errors = validateBody(body);

      if (errors) {
        stats.failed++;
        stats.errors.push({ index: i, errors });
        continue;
      }

      try {
        const db = getDb();
        const mappedData = mapSubmission(body);

        // 查找重复（同一高校+同一周期，且未删除）
        const existingIndex = db.submissions.findIndex(s =>
          s.school_name === mappedData.school_name &&
          s.period_start === mappedData.period_start &&
          s.period_end === mappedData.period_end &&
          !s.deleted
        );

        if (existingIndex !== -1) {
          mappedData.id = db.submissions[existingIndex].id;
          db.submissions[existingIndex] = mappedData;
        } else {
          db.submissions.push(mappedData);
        }

        if (useMongo()) {
          try {
            await Submission.findOneAndUpdate(
              { id: mappedData.id },
              mappedData,
              { upsert: true, new: true }
            );
          } catch (e) {
            console.error('MongoDB import save failed:', e.message);
          }
        }

        stats.success++;
      } catch (err) {
        stats.failed++;
        stats.errors.push({ index: i, errors: [err.message] });
      }
    }

    saveData();

    // 审计日志
    logAudit({
      action: 'IMPORT',
      user: req.admin?.username,
      details: { total: stats.total, success: stats.success, failed: stats.failed },
      ip: req.ip || req.socket.remoteAddress
    }).catch(() => {});

    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ========== 新增：审计日志查询（仅MongoDB模式） ==========
router.get('/admin/audit-logs', authenticate, async (req, res) => {
  try {
    if (!useMongo()) {
      return res.json({
        success: true,
        data: [],
        pagination: { page: 1, pageSize: 20, total: 0 }
      });
    }

    const page = parseInt(req.query.page) || 1;
    const pageSize = capPageSize(req.query.pageSize);
    const action = req.query.action;

    const filter = {};
    if (action) filter.action = action;

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ created_at: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      AuditLog.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: logs,
      pagination: { page, pageSize, total }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 导出 Excel 汇总表（不转义，保留原始字符 + 审计日志）
router.get('/admin/export', authenticate, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const buffer = exportToExcel(startDate, endDate);

    // 审计日志
    logAudit({
      action: 'EXPORT',
      user: req.admin?.username,
      details: { type: 'summary', startDate, endDate },
      ip: req.ip || req.socket.remoteAddress
    }).catch(() => {});

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="survey-export.xlsx"');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 导出未提交高校（+ 审计日志）
router.get('/admin/export/unsubmitted', authenticate, async (req, res) => {
  try {
    const { weekStart, weekEnd } = req.query;
    if (!weekStart || !weekEnd) {
      return res.status(400).json({ success: false, message: 'Missing weekStart or weekEnd' });
    }
    const unsubmitted = getUnsubmittedSchools();
    const buffer = exportUnsubmittedExcel(weekStart, weekEnd, unsubmitted);

    // 审计日志
    logAudit({
      action: 'EXPORT',
      user: req.admin?.username,
      details: { type: 'unsubmitted', weekStart, weekEnd },
      ip: req.ip || req.socket.remoteAddress
    }).catch(() => {});

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="unsubmitted-schools.xlsx"');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 导出原始数据（+ 审计日志）
router.get('/admin/export/raw', authenticate, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const buffer = exportRawData(startDate, endDate);

    // 审计日志
    logAudit({
      action: 'EXPORT',
      user: req.admin?.username,
      details: { type: 'raw', startDate, endDate },
      ip: req.ip || req.socket.remoteAddress
    }).catch(() => {});

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="raw-data.xlsx"');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 学校列表
router.get('/admin/schools', authenticate, (req, res) => {
  res.json({ success: true, data: SCHOOLS });
});

export default router;

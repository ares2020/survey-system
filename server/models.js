// MongoDB Schema Definitions (mongoose)
// Falls back to JSON file if MongoDB not connected

import mongoose from 'mongoose';

// ========== Submission Schema ==========
const ResearchItemSchema = new mongoose.Schema({
  item_date: String,
  item_name: String,
  item_org: String,
  item_result: String
}, { _id: false });

const PublicityItemSchema = new mongoose.Schema({
  pub_date: String,
  activity_name: String,
  media_name: String,
  link: String,
  level: String
}, { _id: false });

const PlannedActivitySchema = new mongoose.Schema({
  activity_date: String,
  name: String,
  location: String,
  organizer: String,
  description: String
}, { _id: false });

const CompletedActivitySchema = new mongoose.Schema({
  news_title: String,
  pub_date: String,
  platform: String,
  link: String,
  summary: String
}, { _id: false });

const SubmissionSchema = new mongoose.Schema({
  // 基础信息
  id: { type: Number, required: true, unique: true },
  school_name: String,
  reporter_name: String,
  reporter_position: String,
  phone: String,
  email: String,
  period_start: String,
  period_end: String,
  submitted_at: String,

  // I. 就业引航
  q8_weekly_lectures: { type: Number, default: 0 },
  q9_weekly_reach: { type: Number, default: 0 },
  q10_cumul_lectures: { type: Number, default: null },
  q11_cumul_reach: { type: Number, default: null },
  q12_has_lecture: String,
  q13_weekly_tuanri: { type: Number, default: 0 },
  q14_cumul_tuanri: { type: Number, default: null },
  q15_provincial_desc: String,

  // II. 千校万岗
  q16_weekly_recruit: { type: Number, default: 0 },
  q17_weekly_companies: { type: Number, default: 0 },
  q18_weekly_jobs: { type: Number, default: 0 },
  q19_cumul_recruit: { type: Number, default: null },
  q20_cumul_companies: { type: Number, default: null },
  q21_cumul_jobs: { type: Number, default: null },

  // III. 扬帆计划-政务实习
  q22_gov_units: { type: Number, default: 0 },
  q23_gov_jobs: { type: Number, default: 0 },
  q24_gov_students: { type: Number, default: 0 },
  q25_cumul_gov_units: { type: Number, default: null },
  q26_cumul_gov_jobs: { type: Number, default: null },
  q27_cumul_gov_students: { type: Number, default: null },

  // III. 企业实习
  q28_ent_units: { type: Number, default: 0 },
  q29_ent_jobs: { type: Number, default: 0 },
  q30_ent_students: { type: Number, default: 0 },
  q31_cumul_ent_units: { type: Number, default: null },
  q32_cumul_ent_jobs: { type: Number, default: null },
  q33_cumul_ent_students: { type: Number, default: null },

  // III. 职场体验
  q34_exp_sessions: { type: Number, default: 0 },
  q35_exp_reach: { type: Number, default: 0 },
  q36_cumul_exp_sessions: { type: Number, default: null },
  q37_cumul_exp_reach: { type: Number, default: null },

  // IV. 创业带动就业
  q38_new_shops: { type: Number, default: 0 },
  q39_cumul_shops: { type: Number, default: null },
  q40_cumul_students: { type: Number, default: null },
  q41_national_landings: { type: Number, default: 0 },
  q41_national_companies: { type: Number, default: 0 },
  q41_national_talents: { type: Number, default: 0 },
  q41_national_funds: { type: Number, default: 0 },
  q42_national_desc: String,
  q43_provincial_landings: { type: Number, default: 0 },
  q43_provincial_companies: { type: Number, default: 0 },
  q43_provincial_talents: { type: Number, default: 0 },
  q43_provincial_funds: { type: Number, default: 0 },
  q44_provincial_desc: String,
  q45_city_shops_desc: String,

  // V. 其他工作
  q46_has_research: String,
  q48_has_publicity: String,

  // 子表
  research_items: [ResearchItemSchema],
  publicity_items: [PublicityItemSchema],
  planned_activities: [PlannedActivitySchema],
  completed_activities: [CompletedActivitySchema],

  // 软删除
  deleted: { type: Boolean, default: false },
  deleted_at: String
}, { timestamps: true });

// ========== Admin Schema ==========
const AdminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  created_at: { type: String, default: () => new Date().toISOString() }
});

// ========== Audit Log Schema ==========
const AuditLogSchema = new mongoose.Schema({
  action: { type: String, required: true }, // CREATE/UPDATE/DELETE/LOGIN/EXPORT/PASSWORD_CHANGE
  user: String, // username or 'anonymous'
  target_id: Number, // affected submission id
  target_type: { type: String, default: 'submission' },
  details: mongoose.Schema.Types.Mixed, // flexible details
  ip: String,
  created_at: { type: String, default: () => new Date().toISOString() }
});

// Create models
export const Submission = mongoose.model('Submission', SubmissionSchema);
export const Admin = mongoose.model('Admin', AdminSchema);
export const AuditLog = mongoose.model('AuditLog', AuditLogSchema);

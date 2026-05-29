import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { Submission, Admin, AuditLog } from './models.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.resolve(DATA_DIR, 'data.json');

let data = null;
let nextId = 1;
let mongoConnected = false;

// ========== JSON文件操作 ==========

function loadJsonData() {
  if (data) return data;
  if (fs.existsSync(DATA_FILE)) {
    try {
      data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    } catch (e) {
      console.error('Failed to parse JSON data file, starting fresh:', e.message);
      data = { submissions: [], admins: [] };
    }
  } else {
    data = { submissions: [], admins: [] };
  }
  // 确保数组存在
  if (!data.submissions) data.submissions = [];
  if (!data.admins) data.admins = [];
  // 向后兼容：确保deleted字段
  for (const s of data.submissions) {
    if (s.deleted === undefined) s.deleted = false;
  }
  return data;
}

/** 返回内存中的数据对象（所有模式统一） */
export function getDb() {
  return loadJsonData();
}

/** 获取下一个自增ID */
export function getNextId() {
  return nextId++;
}

/** 是否使用MongoDB */
export function useMongo() {
  return mongoConnected;
}

/** 保存数据 — JSON模式写入文件，MongoDB模式不操作文件（数据已通过mongoose API保存） */
export function saveData() {
  if (mongoConnected) {
    // MongoDB模式下数据已通过mongoose API保存，不操作文件
    return;
  }
  if (data) {
    try {
      if (fs.existsSync(DATA_FILE)) {
        fs.copyFileSync(DATA_FILE, DATA_FILE + '.bak');
      }
    } catch (e) { /* ignore backup failure */ }
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
    console.log('Data saved to', DATA_FILE, 'submissions:', data.submissions?.length || 0);
  }
}

// ========== MongoDB文档清理 ==========

function cleanMongoDoc(doc) {
  if (!doc) return doc;
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  delete obj._id;
  delete obj.__v;
  delete obj.createdAt;
  delete obj.updatedAt;
  return obj;
}

// ========== 审计日志（不阻塞主流程） ==========

export async function logAudit(auditData) {
  if (mongoConnected) {
    try {
      await AuditLog.create({
        ...auditData,
        created_at: auditData.created_at || new Date().toISOString()
      });
    } catch (e) {
      // 审计日志失败静默处理，不阻塞主流程
    }
  }
  // JSON模式下审计日志不保存（无存储位置）
}

// ========== MongoDB数据同步 ==========

async function syncFromMongo() {
  if (!mongoConnected) return;
  try {
    const [subs, admins] = await Promise.all([
      Submission.find({}).lean(),
      Admin.find({}).lean()
    ]);
    data.submissions = subs.map(cleanMongoDoc);
    data.admins = admins.map(cleanMongoDoc);
    // 重新计算nextId
    if (data.submissions.length > 0) {
      nextId = Math.max(...data.submissions.map(s => s.id || 0)) + 1;
    } else {
      nextId = 1;
    }
  } catch (err) {
    console.error('Failed to sync from MongoDB:', err.message);
  }
}

// ========== 初始化数据库 ==========

export async function initDatabase() {
  // 确保数据目录存在
  if (!fs.existsSync(DATA_DIR)) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      console.log('Created data directory:', DATA_DIR);
    } catch (e) {
      console.error('Failed to create data directory:', DATA_DIR, e.message);
    }
  }

  // 加载JSON数据到内存
  loadJsonData();

  // 计算 nextId
  if (data.submissions && data.submissions.length > 0) {
    const maxId = Math.max(...data.submissions.map(s => s.id || 0));
    nextId = maxId + 1;
  } else {
    nextId = 1;
  }

  // 尝试连接MongoDB
  const uri = process.env.MONGODB_URI;
  if (uri) {
    try {
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
        maxPoolSize: 10
      });
      mongoConnected = true;
      console.log('MongoDB connected successfully');
    } catch (err) {
      console.error('MongoDB connection failed, using JSON fallback:', err.message);
      mongoConnected = false;
    }
  } else {
    console.log('MONGODB_URI not set, using JSON file database');
  }

  // MongoDB模式：数据迁移或同步
  if (mongoConnected) {
    try {
      const subCount = await Submission.countDocuments();
      const adminCount = await Admin.countDocuments();

      if (subCount === 0 && adminCount === 0 && (data.submissions.length > 0 || data.admins.length > 0)) {
        // MongoDB为空，自动迁移JSON数据
        console.log('MongoDB is empty, migrating JSON data...');
        for (const sub of data.submissions) {
          await Submission.create(sub);
        }
        for (const admin of data.admins) {
          await Admin.create(admin);
        }
        console.log('Data migration complete:', data.submissions.length, 'submissions,', data.admins.length, 'admins');
      } else if (subCount > 0 || adminCount > 0) {
        // MongoDB已有数据，同步到内存保持一致的视图
        await syncFromMongo();
      }
    } catch (err) {
      console.error('MongoDB data migration/sync failed:', err.message);
    }
  }

  // 确保默认管理员存在
  const bcryptModule = await import('bcryptjs');
  const bcrypt = bcryptModule.default || bcryptModule;

  if (!mongoConnected) {
    // JSON模式
    const existing = data.admins.find(a => a.username === 'admin');
    if (!existing) {
      data.admins.push({
        id: 1,
        username: 'admin',
        password: bcrypt.hashSync('admin123', 10),
        created_at: new Date().toISOString()
      });
      saveData();
    }
  } else {
    // MongoDB模式
    try {
      const existing = await Admin.findOne({ username: 'admin' });
      if (!existing) {
        await Admin.create({
          id: 1,
          username: 'admin',
          password: bcrypt.hashSync('admin123', 10),
          created_at: new Date().toISOString()
        });
        await syncFromMongo();
      }
    } catch (err) {
      console.error('Failed to create default admin in MongoDB:', err.message);
    }
  }

  console.log('Database initialized. Mode:', mongoConnected ? 'MongoDB' : 'JSON');
  console.log('Data file:', DATA_FILE);
  console.log('Submissions count:', data.submissions?.length || 0);
  console.log('Next ID:', nextId);
  if (!mongoConnected) {
    console.log('Admin: admin / admin123');
  }
}

// 重新导出mongoose模型
export { Submission, Admin, AuditLog };

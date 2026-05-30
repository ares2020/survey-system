import mongoose from 'mongoose';
const MONGODB_URI = 'mongodb+srv://847315502:pARNzOzlphaPk8BP@cluster0.f2uqbsm.mongodb.net/survey-system?retryWrites=true&w=majority&appName=Cluster0';

async function main() {
  await mongoose.connect(MONGODB_URI);
  const Submission = mongoose.models.Submission || mongoose.model('Submission', new mongoose.Schema({}, {strict: false}));

  // 1. 清除所有活跃记录的 deleted_at 字段
  const clearResult = await Submission.updateMany(
    { deleted: false },
    { $set: { deleted_at: null } }
  );
  console.log('Cleared deleted_at for active records:', clearResult.modifiedCount);

  // 2. 删除重复的旧记录（只保留每个学校的最新记录）
  const allSubs = await Submission.find({ deleted: false }).lean();
  const schoolMap = new Map();
  for (const sub of allSubs) {
    if (!schoolMap.has(sub.school_name)) {
      schoolMap.set(sub.school_name, []);
    }
    schoolMap.get(sub.school_name).push(sub);
  }

  let deletedCount = 0;
  for (const [name, subs] of schoolMap.entries()) {
    if (subs.length > 1) {
      subs.sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));
      const toDelete = subs.slice(1);
      for (const sub of toDelete) {
        await Submission.findByIdAndUpdate(sub._id, {
          deleted: true,
          deleted_at: new Date().toISOString()
        });
        deletedCount++;
        console.log('Deleted duplicate:', name, 'submitted_at:', sub.submitted_at);
      }
    }
  }
  console.log('Total deleted duplicates:', deletedCount);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

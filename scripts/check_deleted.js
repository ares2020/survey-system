import mongoose from 'mongoose';
const MONGODB_URI = 'mongodb+srv://847315502:pARNzOzlphaPk8BP@cluster0.f2uqbsm.mongodb.net/survey-system?retryWrites=true&w=majority&appName=Cluster0';

async function main() {
  await mongoose.connect(MONGODB_URI);
  const Submission = mongoose.models.Submission || mongoose.model('Submission', new mongoose.Schema({}, {strict: false}));
  
  // 检查 deleted_at 情况
  const all = await Submission.find({ deleted: false }).lean();
  const withDeletedAt = all.filter(s => s.deleted_at !== null && s.deleted_at !== undefined);
  const withoutDeletedAt = all.filter(s => s.deleted_at === null || s.deleted_at === undefined);
  console.log('active with deleted_at:', withDeletedAt.length);
  console.log('active with deleted_at=null/undefined:', withoutDeletedAt.length);
  if (withDeletedAt.length > 0) {
    console.log('example:', withDeletedAt[0].school_name, withDeletedAt[0].deleted_at);
  }
  if (withoutDeletedAt.length > 0) {
    console.log('example clean:', withoutDeletedAt[0].school_name, withoutDeletedAt[0].deleted_at);
  }
  
  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

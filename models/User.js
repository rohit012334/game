import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({}, {
  collection: 'users',
  strict: false,
  versionKey: false,
  timestamps: true,
});

const User = mongoose.model('User', userSchema);
export default User;
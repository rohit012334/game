import mongoose from 'mongoose';

const roundResultSchema = new mongoose.Schema({
  game: { type: String, default: "fruit", index: true },
  roundId: { type: String, unique: true, required: true },
  winner: { type: String, enum: ["grape", "watermelon", "orange", "lemon", "apple", "banana", "cherry", "pineapple", "mango"], required: true },
  winnerIndex: { type: Number, required: false, min: 0, max: 8 },
  timestamp: { type: Date, default: Date.now },
}, { timestamps: true });

const RoundResult = mongoose.model('RoundResult', roundResultSchema);
export default RoundResult;
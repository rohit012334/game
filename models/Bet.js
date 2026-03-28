import mongoose from 'mongoose';

const betSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  roundId: { type: String, required: true },
  side: { type: String, enum: ["grape", "watermelon", "orange", "lemon", "apple", "banana", "cherry", "pineapple", "mango"], required: true },
  sideIndex: { type: Number, required: true, min: 0, max: 8 },
  amount: { type: Number, required: true },
  won: { type: Boolean, default: false },
  payout: { type: Number, default: 0 },
  status: { type: String, enum: ["pending", "settled"], default: "pending" },
  timestamp: { type: Date, default: Date.now },
}, { timestamps: true });

const Bet = mongoose.model('Bet', betSchema);
export default Bet;
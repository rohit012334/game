import mongoose from 'mongoose';

const betSchema = new mongoose.Schema({
  game: {
    type: String,
    default: "fruit",   // ✅ Fruit game identifier
    index: true
  },
  userId: { type: String, required: true },   // firebaseUid store hoga
  roundId: { type: String, required: true },
  side: { type: String, enum: ["grape", "watermelon", "orange", "lemon", "apple", "banana", "cherry", "pineapple", "mango"], required: true },
  sideIndex: { type: Number, required: true, min: 0, max: 8 },
  amount: { type: Number, required: true },
  won: { type: Boolean, default: false },
  payout: { type: Number, default: 0 },
  status: { type: String, enum: ["pending", "settled"], default: "pending" },
  timestamp: { type: Date, default: Date.now },
}, { timestamps: true });

betSchema.index({ userId: 1, roundId: 1 });
betSchema.index({ createdAt: -1 });

const Bet = mongoose.model('Bet', betSchema);
export default Bet;
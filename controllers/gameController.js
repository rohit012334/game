import User from '../models/User.js';
import Bet from '../models/Bet.js';
import RoundResult from '../models/RoundResult.js';
import gameService from '../services/gameService.js';

export const getWallet = async (req, res) => {
  const { userId } = req.params;
  try {
    const user = await User.findOne({ userId });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

export const register = async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });
  try {
    let user = await User.findOne({ userId });
    if (user) return res.status(400).json({ error: "User already exists" });
    user = new User({ userId, balance: 1000 });
    await user.save();
    res.json({ status: "ok", balance: user.balance });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: "User already exists" });
    res.status(500).json({ error: "Server error" });
  }
};

export const getCurrentRound = (req, res) => {
  const round = gameService.getCurrentRound();
  res.json({
    roundId: round.roundId,
    time: round.time,
    status: round.status,
    totals: round.totals
  });
};

export const getHistory = async (req, res) => {
  const { userId } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  try {
    const total = await Bet.countDocuments({ userId });
    const bets = await Bet.find({ userId })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      data: bets.map(bet => ({
        roundId: bet.roundId,
        side: bet.side,
        amount: bet.amount,
        won: bet.won,
        payout: bet.payout,
        timestamp: bet.timestamp
      })),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

const processSingleBetREST = async (betItem) => {
  const { userId, roundId, side, amount } = betItem;
  const selectedSymbol = side;
  const parsedAmount = Math.floor(parseInt(amount));

  if (!parsedAmount || isNaN(parsedAmount) || parsedAmount <= 0) {
    throw new Error("Invalid amount");
  }
  if (parsedAmount < 10) throw new Error("Minimum bet ₹10");
  if (parsedAmount > 50000) throw new Error("Maximum bet ₹50,000");

  const currentRound = gameService.getCurrentRound();
  const validSymbols = ["grape", "watermelon", "orange", "lemon", "apple", "banana", "cherry", "pineapple", "mango"];

  if (!selectedSymbol || !validSymbols.includes(selectedSymbol)) {
    throw new Error("Invalid symbol selection");
  }
  if (roundId !== currentRound.roundId) {
    throw new Error("Round expired");
  }
  if (currentRound.status !== "betting" || currentRound.time <= 3) {
    throw new Error("Betting is closed");
  }

  const user = await User.findOneAndUpdate(
    { userId, balance: { $gte: parsedAmount } },
    { $inc: { balance: -parsedAmount } },
    { returnDocument: 'after' }
  );

  if (!user) {
    throw new Error(`Insufficient balance for ${selectedSymbol}`);
  }

  const symbolIndex = validSymbols.indexOf(selectedSymbol);
  const betData = {
    userId,
    roundId,
    side: selectedSymbol,
    sideIndex: symbolIndex,
    amount: parsedAmount,
    timestamp: Date.now(),
    won: false,
    payout: 0,
    status: "pending"
  };

  const newBet = await Bet.create(betData);
  betData._id = newBet._id;

  try {
    gameService.addBetToCache(betData);
    return { success: true, message: "Bet placed!", balance: user.balance, side: selectedSymbol };
  } catch (cacheErr) {
    await User.findOneAndUpdate({ userId }, { $inc: { balance: parsedAmount } });
    await Bet.deleteOne({ _id: newBet._id });
    throw cacheErr;
  }
};

export const placeBet = async (req, res) => {
  try {
    const data = req.body;
    const betsToProcess = Array.isArray(data) ? data : [data];
    const results = [];

    for (const b of betsToProcess) {
      try {
        const resObj = await processSingleBetREST(b);
        results.push(resObj);
      } catch (err) {
        results.push({ success: false, message: err.message, side: b.side });
      }
    }

    res.json({ success: true, results });
  } catch (err) {
    console.error("HTTP Bet error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getRecentResults = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  try {
    const total = await RoundResult.countDocuments();
    const results = await RoundResult.find()
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      data: results,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

export const getRoundStats = (req, res) => {
  const round = gameService.getCurrentRound();
  res.json({ roundId: round.roundId, totals: round.totals });
};
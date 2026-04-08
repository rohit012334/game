import User from '../models/User.js';
import Bet from '../models/Bet.js';
import gameService from '../services/gameService.js';

const betTimeouts = new Map();
const MIN_BET = 10;
const MAX_BET = 100000000; // 10 Crore
const GAME_TAG = "fruit"; // ✅

const symbols = ["grape", "watermelon", "orange", "lemon", "apple", "banana", "cherry", "pineapple", "mango"];

const socketHandler = (io) => {
  io.on('connection', (socket) => {
    gameService.onlineCount++;
    console.log("🤝 User connected:", socket.id, "| Online:", gameService.onlineCount);

    const currentRound = gameService.getCurrentRound();
    socket.emit('round', {
      roundId: currentRound.roundId,
      time: currentRound.time,
      status: currentRound.status,
      newRound: false,
      totals: currentRound.totals
    });

    const processSingleBet = async (betItem) => {
      const userId = betItem.userId;
      const { roundId, side, fruit, amount } = betItem;
      const selectedSymbol = side || fruit;
      const now = Date.now();

      if (!userId) throw new Error("userId required");

      const parsedAmount = Math.floor(parseInt(amount));
      if (!parsedAmount || isNaN(parsedAmount) || parsedAmount <= 0) throw new Error("Invalid amount");
      if (parsedAmount < MIN_BET) throw new Error(`Minimum bet 10 coins for ${selectedSymbol || 'fruit'}`);
      if (parsedAmount > MAX_BET) throw new Error(`Maximum bet 10,00,00,000 coins for ${selectedSymbol || 'fruit'}`);

      const currentRound = gameService.getCurrentRound();
      gameService.setSocketMapping(userId, socket.id);
      socket.userId = userId;

      if (!symbols.includes(selectedSymbol)) throw new Error(`Invalid symbol: ${selectedSymbol}`);
      if (currentRound.roundId !== roundId) throw new Error("Round expired");
      if (currentRound.status !== "betting" || currentRound.time <= 1) throw new Error("Betting is closed");

      // ✅ { new: true } — Mongoose correct option
      const user = await User.findOneAndUpdate(
        { firebaseUid: userId, coin: { $gte: parsedAmount }, isBlock: false },
        { $inc: { coin: -parsedAmount } },
        { new: true }
      );

      if (!user) throw new Error(`Insufficient coins or user not found for ${selectedSymbol}`);

      const symbolIndex = symbols.indexOf(selectedSymbol);
      const betData = {
        game: GAME_TAG,  // ✅ game tag
        userId,
        roundId,
        side: selectedSymbol,
        sideIndex: symbolIndex,
        amount: parsedAmount,
        timestamp: now,
        won: false,
        payout: 0,
        status: "pending"
      };

      const newBet = await Bet.create(betData);
      betData._id = newBet._id;

      try {
        gameService.addBetToCache(betData);
        return { message: "Bet placed!", coin: user.coin, side: selectedSymbol, amount: parsedAmount };
      } catch (cacheErr) {
        await User.findOneAndUpdate({ firebaseUid: userId }, { $inc: { coin: parsedAmount } });
        await Bet.deleteOne({ _id: newBet._id });
        throw cacheErr;
      }
    };

    socket.on('bet', async (data) => {
      const now = Date.now();
      const lastBet = betTimeouts.get(socket.id);
      if (lastBet && now - lastBet < 500) {
        return socket.emit('error', { message: "Too many requests" });
      }
      betTimeouts.set(socket.id, now);

      try {
        const betsToProcess = Array.isArray(data) ? data : [data];
        for (const b of betsToProcess) {
          try {
            const result = await processSingleBet(b);
            socket.emit('betConfirmed', result);
          } catch (err) {
            socket.emit('betError', { message: err.message, fruit: b.side || b.fruit });
          }
        }
      } catch (err) {
        console.error("Batch bet error:", err);
        socket.emit('error', { message: "Server error" });
      }
    });

    socket.on('disconnect', () => {
      gameService.onlineCount = Math.max(0, gameService.onlineCount - 1);
      if (socket.userId) gameService.removeSocketMapping(socket.userId);
      betTimeouts.delete(socket.id);
      console.log("⛵ Disconnected:", socket.id, "| Online:", gameService.onlineCount);
    });
  });
};

setInterval(() => {
  if (global.ioInstance) {
    global.ioInstance.emit('ONLINE_COUNT', { type: "ONLINE_COUNT", data: gameService.onlineCount });
  }
}, 5000);

export default socketHandler;
import User from '../models/User.js';
import Bet from '../models/Bet.js';
import gameService from '../services/gameService.js';

const betTimeouts = new Map();

const symbols = ["grape", "watermelon", "orange", "lemon", "apple", "banana", "cherry", "pineapple", "mango"];

const socketHandler = (io) => {
  io.on('connection', (socket) => {
    gameService.onlineCount++;
    console.log("🤝 User connected:", socket.id, "| Online:", gameService.onlineCount);

    const processSingleBet = async (betItem) => {
      const { userId, roundId, side, fruit, amount } = betItem;
      const selectedSymbol = side || fruit;
      const now = Date.now();

      const parsedAmount = Math.floor(parseInt(amount));
      if (!parsedAmount || isNaN(parsedAmount) || parsedAmount <= 0) {
        throw new Error("Invalid amount");
      }
      if (parsedAmount < 100) throw new Error(`Minimum bet ₹100 for ${selectedSymbol || 'fruit'}`);
      if (parsedAmount > 50000) throw new Error(`Maximum bet ₹50,000 for ${selectedSymbol || 'fruit'}`);

      const currentRound = gameService.getCurrentRound();
      gameService.setSocketMapping(userId, socket.id);
      socket.userId = userId;

      if (!symbols.includes(selectedSymbol)) {
        throw new Error(`Invalid symbol selection: ${selectedSymbol}`);
      }
      if (currentRound.roundId !== roundId) {
        throw new Error("Round expired");
      }
      if (currentRound.status !== "betting" || currentRound.time <= 3) {
        throw new Error("Betting is closed");
      }

      const user = await User.findOneAndUpdate(
        { userId, balance: { $gte: parsedAmount } },
        { $inc: { balance: -parsedAmount } },
        { new: true }
      );

      if (!user) {
        throw new Error(`Insufficient balance or user not found for ${selectedSymbol}`);
      }

      const symbolIndex = symbols.indexOf(selectedSymbol);
      const betData = {
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
        return {
          message: "Bet placed!",
          balance: user.balance,
          side: selectedSymbol,
          amount: parsedAmount
        };
      } catch (cacheErr) {
        await User.findOneAndUpdate({ userId }, { $inc: { balance: parsedAmount } });
        await Bet.deleteOne({ _id: newBet._id });
        throw cacheErr;
      }
    };

    socket.on('bet', async (data) => {
      const now = Date.now();
      const lastBet = betTimeouts.get(socket.id);
      if (lastBet && now - lastBet < 500) { // Reduced to 500ms for better UX when sending batches
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
            socket.emit('error', { message: err.message, fruit: b.side || b.fruit });
          }
        }
      } catch (err) {
        console.error("Batch bet error:", err);
        socket.emit('error', { message: "Server error" });
      }
    });

    socket.on('disconnect', () => {
      gameService.onlineCount = Math.max(0, gameService.onlineCount - 1);
      if (socket.userId) {
        gameService.removeSocketMapping(socket.userId);
      }
      betTimeouts.delete(socket.id);
      console.log("⛵ User disconnected:", socket.id, "| Online:", gameService.onlineCount);
    });
  });
};

// Broadcast Online Count every 5 seconds
setInterval(() => {
  if (global.ioInstance) {
    global.ioInstance.emit('ONLINE_COUNT', { type: "ONLINE_COUNT", data: gameService.onlineCount });
  }
}, 5000);

export default socketHandler;
import User from '../models/User.js';
import Bet from '../models/Bet.js';
import gameService from '../services/gameService.js';

const betTimeouts = new Map();

const symbols = ["grape", "watermelon", "orange", "lemon", "apple", "banana", "cherry", "pineapple", "mango"];

const socketHandler = (io) => {
  io.on('connection', (socket) => {
    gameService.onlineCount++;
    console.log("🤝 User connected:", socket.id, "| Online:", gameService.onlineCount);

    socket.on('bet', async (data) => {
      const { userId, roundId, side, fruit, amount } = data;
      const selectedSymbol = side || fruit;

      const now = Date.now();
      const lastBet = betTimeouts.get(socket.id);
      if (lastBet && now - lastBet < 1000) {
        return socket.emit('error', { message: "Too many requests. Please wait 1 second." });
      }
      betTimeouts.set(socket.id, now);

      const parsedAmount = Math.floor(parseInt(amount));
      if (!parsedAmount || isNaN(parsedAmount) || parsedAmount <= 0) {
        return socket.emit('error', { message: "Invalid amount" });
      }

      if (parsedAmount < 10) return socket.emit('error', { message: "Minimum bet ₹10" });
      if (parsedAmount > 50000) return socket.emit('error', { message: "Maximum bet ₹50,000" });

      const currentRound = gameService.getCurrentRound();
      gameService.setSocketMapping(userId, socket.id);
      socket.userId = userId;

      if (!symbols.includes(selectedSymbol)) {
        return socket.emit('error', { message: "Invalid symbol selection" });
      }
      if (currentRound.roundId !== roundId) {
        return socket.emit('error', { message: "Round expired" });
      }
      if (currentRound.status !== "betting" || currentRound.time <= 3) {
        return socket.emit('error', { message: "Betting is closed" });
      }

      // Check if user already bet on THIS specific fruit
      const existingBetOnSymbol = currentRound.bets.find(b => b.userId === userId && b.side === selectedSymbol);
      if (existingBetOnSymbol) {
        return socket.emit('error', { message: "Already bet on this symbol" });
      }

      try {
        const user = await User.findOneAndUpdate(
          { userId, balance: { $gte: parsedAmount } },
          { $inc: { balance: -parsedAmount } },
          { new: true }
        );

        if (!user) {
          return socket.emit('error', { message: "Insufficient balance or user not found" });
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

        try {
          gameService.addBetToCache(betData);
        } catch (cacheErr) {
          await User.findOneAndUpdate({ userId }, { $inc: { balance: parsedAmount } });
          await Bet.deleteOne({ _id: newBet._id });
          return socket.emit('error', { message: cacheErr.message });
        }

        socket.emit('betConfirmed', {
          message: "Bet placed!",
          balance: user.balance,
          side: selectedSymbol,
          amount: parsedAmount
        });

      } catch (err) {
        console.error("Bet error:", err);
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
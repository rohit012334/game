import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import User from '../models/User.js';
import Bet from '../models/Bet.js';
import RoundResult from '../models/RoundResult.js';
import DailyStat from '../models/DailyStat.js';

class GameService {
  constructor() {
    this.SYMBOLS = ["grape", "watermelon", "orange", "lemon", "apple", "banana", "cherry", "pineapple", "mango"];
    this.MULTIPLIERS = {
      "grape": 100,
      "watermelon": 5,
      "orange": 25,
      "lemon": 5,
      "apple": 10,
      "banana": 5,
      "cherry": 20,
      "pineapple": 5,
      "mango": 15
    };

    this.currentRound = {
      roundId: uuidv4(),
      time: 30,
      status: "betting",
      bets: [],
      totals: this.SYMBOLS.reduce((acc, symbol) => ({ ...acc, [symbol]: 0 }), {})
    };
    this.io = null;
    this.userIdToSocket = new Map();  // firebaseUid → socketId
    this.userLastBets = new Map();    // firebaseUid → bet history
    this.onlineCount = 0;
    this.isProcessingRoundEnd = false;

    this.EXPOSURE_LIMIT_PER_ROUND = 10000000000; // 1000 Crore backup for 10 Cr bets
    this.DAILY_MAX_LOSS_LIMIT = 50000000;     // 500 Crore
    this.HOUSE_EDGE_THRESHOLD = 700000;        // 50k coins threshold for logic

    this.dailyLoss = 0;
    this.dailyProfit = 0;
    this.currentDate = new Date().toISOString().split('T')[0];
    this.initDailyStats();
  }

  async initDailyStats() {
    const today = new Date().toISOString().split('T')[0];
    this.currentDate = today;
    let stats = await DailyStat.findOne({ date: today });
    if (!stats) {
      stats = await DailyStat.create({ date: today });
    }
    this.dailyLoss = stats.totalHouseLoss;
    this.dailyProfit = stats.totalHouseProfit;
    console.log(`🌀 Neon Strike Daily Stats Initialized: Loss: ${this.dailyLoss}, Profit: ${this.dailyProfit}`);
  }

  async checkDailyReset() {
    const today = new Date().toISOString().split('T')[0];
    if (this.currentDate !== today) {
      console.log(`📅 Daily Reset: ${this.currentDate} -> ${today}`);
      this.currentDate = today;
      this.dailyLoss = 0;
      this.dailyProfit = 0;
      await DailyStat.create({ date: today }).catch(() => { });
    }
  }

  setIO(io) {
    this.io = io;
    this.startTimer();
  }

  setSocketMapping(firebaseUid, socketId) {
    this.userIdToSocket.set(firebaseUid, socketId);
  }

  removeSocketMapping(firebaseUid) {
    this.userIdToSocket.delete(firebaseUid);
  }

  updateUserCache(firebaseUid, bet) {
    let data = this.userLastBets.get(firebaseUid) || { bets: [], lastActive: Date.now() };
    data.bets.push(bet);
    if (data.bets.length > 5) data.bets.shift();
    data.lastActive = Date.now();
    this.userLastBets.set(firebaseUid, data);
    if (this.userLastBets.size > 10000) this.userLastBets.clear();
  }

  cleanupUserCache() {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    for (const [uid, data] of this.userLastBets.entries()) {
      if (data.lastActive < oneHourAgo) this.userLastBets.delete(uid);
    }
  }

  isUserHighRisk(firebaseUid, curAmount) {
    const data = this.userLastBets.get(firebaseUid);
    const history = data ? data.bets : null;
    if (!history || history.length < 3) return false;

    let isDoubling = true;
    for (let i = 1; i < history.length; i++) {
      if (history[i].amount < history[i - 1].amount * 1.8) {
        isDoubling = false;
        break;
      }
    }
    return isDoubling && curAmount >= history[history.length - 1].amount * 1.8;
  }

  generateGrid(winnerSymbol) {
    let grid = [];
    for (let i = 0; i < 9; i++) {
      grid.push(this.SYMBOLS[Math.floor(Math.random() * this.SYMBOLS.length)]);
    }
    const randomPos = Math.floor(Math.random() * 9);
    grid[randomPos] = winnerSymbol;
    return { grid, winningCells: [randomPos] };
  }

  generateResult() {
    const totals = this.currentRound.totals;
    const exposures = this.SYMBOLS.map((symbol) => ({
      name: symbol,
      exposure: Math.floor(totals[symbol] * (this.MULTIPLIERS[symbol] || 1))
    }));

    const isDailyLimitExceeded = this.dailyLoss - this.dailyProfit >= this.DAILY_MAX_LOSS_LIMIT;
    if (isDailyLimitExceeded) {
      return exposures.sort((a, b) => a.exposure - b.exposure)[0].name;
    }

    const totalBetAmount = Object.values(totals).reduce((a, b) => a + b, 0);
    if (totalBetAmount < this.HOUSE_EDGE_THRESHOLD) {
      return this.SYMBOLS[Math.floor(Math.random() * this.SYMBOLS.length)];
    }

    const sortedExposures = [...exposures].sort((a, b) => a.exposure - b.exposure);
    const rand = Math.random();
    if (rand < 0.70) return sortedExposures[0].name;
    if (rand < 0.90) return sortedExposures[1].name || sortedExposures[0].name;
    return sortedExposures[Math.floor(Math.random() * sortedExposures.length)].name;
  }

  async processRoundEnd() {
    await this.checkDailyReset();
    this.cleanupUserCache();

    this.currentRound.status = "result";
    const winnerName = this.generateResult();
    const { grid, winningCells } = this.generateGrid(winnerName);
    const message = `🎲 ${winnerName} Wins!`;
    const roundBets = [...this.currentRound.bets];
    const rid = this.currentRound.roundId;

    await RoundResult.create({
      game: "fruit",      // ✅
      roundId: rid,
      winner: winnerName
    });

    if (this.io) {
      this.io.emit('result', { roundId: rid, result: winnerName, grid, winningCells, message });

      if (winnerName === "mango") {
        this.io.emit('JACKPOT', {
          type: "JACKPOT",
          data: { userId: "user_multi", amount: 5000, symbol: "mango" }
        });
      }
    }

    let roundHousePayout = 0;
    const roundHouseRevenue = Object.values(this.currentRound.totals).reduce((a, b) => a + b, 0);
    const isJackpotRound = winnerName === "mango";

    const userBetsMap = new Map();
    for (const bet of roundBets) {
      if (!userBetsMap.has(bet.userId)) userBetsMap.set(bet.userId, []);
      userBetsMap.get(bet.userId).push(bet);
    }

    const userStatsPromises = Array.from(userBetsMap.entries()).map(async ([firebaseUid, bets]) => {
      let totalPayout = 0;
      let totalLostAmount = 0;
      let hasWon = false;
      const individualResults = [];
      const betUpdates = [];

      console.log(`👤 Processing results for user: ${firebaseUid}, total bets: ${bets.length}`);

      // Step 1: Memory mein calculate karo
      for (const bet of bets) {
        const isWinner = bet.side === winnerName;
        const multiplier = this.MULTIPLIERS[bet.side] || 0;
        let payout = isWinner ? Math.floor(bet.amount * multiplier) : 0;

        if (isWinner && isJackpotRound) payout += 5000;

        if (isWinner) {
          totalPayout += payout;
          hasWon = true;
          roundHousePayout += payout;
        } else {
          totalLostAmount += bet.amount;
        }

        individualResults.push({ side: bet.side, amount: bet.amount, won: isWinner, payout });
        betUpdates.push({ id: bet._id, won: isWinner, payout });

        this.updateUserCache(firebaseUid, {
          amount: bet.amount,
          side: bet.side,
          won: isWinner,
          roundId: rid
        });
      }

      // Step 2: ✅ WePlayChat User collection mein coin update
      let updatedUser = null;
      const incUpdate = {};
      if (totalPayout > 0) incUpdate.coin = totalPayout;
      if (totalLostAmount > 0) incUpdate.spentCoins = totalLostAmount;

      if (Object.keys(incUpdate).length > 0) {
        console.log(`💰 Updating user ${firebaseUid}:`, incUpdate);
        updatedUser = await User.findOneAndUpdate(
          { firebaseUid },
          { $inc: incUpdate },
          { new: true, lean: true }
        );
      } else {
        updatedUser = await User.findOne({ firebaseUid }).select('coin spentCoins').lean();
      }

      // Step 3: User ko result emit karo
      const socketId = this.userIdToSocket.get(firebaseUid);
      if (socketId && this.io) {
        this.io.to(socketId).emit('betResult', {
          won: hasWon,
          totalPayout,
          coin: updatedUser ? updatedUser.coin : 0,
          spentCoins: updatedUser ? (updatedUser.spentCoins || 0) : 0,
          spentcoins: updatedUser ? (updatedUser.spentCoins || 0) : 0, // Lowercase alias
          results: individualResults
        });
      }

      // Step 4: Bet documents background mein settle karo
      for (const b of betUpdates) {
        Bet.findOneAndUpdate(
          { _id: b.id, game: "fruit" },   // ✅
          { won: b.won, payout: b.payout, status: "settled" }
        ).catch(() => { });
      }
    });

    await Promise.all(userStatsPromises);

    this.dailyLoss += roundHousePayout;
    this.dailyProfit += roundHouseRevenue;
    await DailyStat.findOneAndUpdate(
      { date: this.currentDate },
      { $inc: { totalHouseLoss: roundHousePayout, totalHouseProfit: roundHouseRevenue } }
    );

    await new Promise(resolve => setTimeout(resolve, 5000));

    this.currentRound = {
      roundId: uuidv4(),
      time: 30,
      status: "betting",
      bets: [],
      totals: this.SYMBOLS.reduce((acc, symbol) => ({ ...acc, [symbol]: 0 }), {})
    };
  }

  startTimer() {
    setInterval(() => {
      if (this.currentRound.time > 0) {
        this.currentRound.time--;
      } else if (this.currentRound.status === "betting" && !this.isProcessingRoundEnd) {
        this.isProcessingRoundEnd = true;
        this.processRoundEnd()
          .catch((err) => console.error("Round processing error:", err))
          .finally(() => { this.isProcessingRoundEnd = false; });
      }

      if (this.io) {
        this.io.emit('round', {
          roundId: this.currentRound.roundId,
          time: this.currentRound.time,
          status: this.currentRound.status,
          newRound: this.currentRound.time === 29,
          totals: this.currentRound.totals
        });
      }
    }, 1000);
  }

  getCurrentRound() { return this.currentRound; }

  addBetToCache(bet) {
    if (this.currentRound.status !== "betting") throw new Error("Betting is closed");
    if (this.currentRound.time <= 1) throw new Error("Too late to bet");

    const sideIndex = this.SYMBOLS.indexOf(bet.side);
    if (sideIndex === -1) throw new Error("Invalid symbol selected");

    const multiplier = this.MULTIPLIERS[bet.side];
    const exposure = Math.floor((this.currentRound.totals[bet.side] + bet.amount) * multiplier);

    if (exposure > this.EXPOSURE_LIMIT_PER_ROUND) throw new Error("Pool limit reached for this fruit");

    if (this.isUserHighRisk(bet.userId, bet.amount)) {
      throw new Error("Bet limit reduced due to high-risk pattern");
    }

    this.currentRound.bets.push(bet);
    this.currentRound.totals[bet.side] += bet.amount;
  }
}

export default new GameService();
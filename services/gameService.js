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
      "grape": 28,
      "watermelon": 5,
      "orange": 5,
      "lemon": 5,
      "apple": 10,
      "banana": 5,
      "cherry": 18,
      "pineapple": 5,
      "mango": 38
    };

    this.currentRound = {
      roundId: uuidv4(),
      time: 60,
      status: "betting",
      bets: [],
      totals: this.SYMBOLS.reduce((acc, symbol) => ({ ...acc, [symbol]: 0 }), {})
    };
    this.io = null;
    this.userIdToSocket = new Map();
    this.userLastBets = new Map();
    this.onlineCount = 0;

    this.EXPOSURE_LIMIT_PER_ROUND = 500000;
    this.DAILY_MAX_LOSS_LIMIT = 500000;
    this.HOUSE_EDGE_THRESHOLD = 3000;

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
    console.log(`🌀 Neon Strike Game Daily Stats Initialized: Loss: ${this.dailyLoss}, Profit: ${this.dailyProfit}`);
  }

  async checkDailyReset() {
    const today = new Date().toISOString().split('T')[0];
    if (this.currentDate !== today) {
      console.log(`📅 Daily Reset Triggered: ${this.currentDate} -> ${today}`);
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

  setSocketMapping(userId, socketId) {
    this.userIdToSocket.set(userId, socketId);
  }

  removeSocketMapping(userId) {
    this.userIdToSocket.delete(userId);
  }

  updateUserCache(userId, bet) {
    let data = this.userLastBets.get(userId) || { bets: [], lastActive: Date.now() };

    data.bets.push(bet);
    if (data.bets.length > 5) data.bets.shift();
    data.lastActive = Date.now();

    this.userLastBets.set(userId, data);

    if (this.userLastBets.size > 10000) {
      this.userLastBets.clear();
    }
  }

  cleanupUserCache() {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    for (const [userId, data] of this.userLastBets.entries()) {
      if (data.lastActive < oneHourAgo) {
        this.userLastBets.delete(userId);
      }
    }
  }

  isUserHighRisk(userId, curAmount) {
    const data = this.userLastBets.get(userId);
    const history = data ? data.bets : null;
    if (!history || history.length < 3) return false;

    let isDoubling = true;
    for (let i = 1; i < history.length; i++) {
      if (history[i].amount < history[i - 1].amount * 1.8) {
        isDoubling = false;
        break;
      }
    }

    if (isDoubling && curAmount >= history[history.length - 1].amount * 1.8) {
      return true;
    }
    return false;
  }

  generateGrid(winnerSymbol) {
    let grid = [];
    for (let i = 0; i < 9; i++) {
      grid.push(this.SYMBOLS[Math.floor(Math.random() * this.SYMBOLS.length)]);
    }
    // Ensure the winner is in the grid
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

    await RoundResult.create({ roundId: rid, winner: winnerName });

    if (this.io) {
      this.io.emit('result', {
        roundId: rid,
        result: winnerName,
        grid,
        winningCells,
        message
      });

      // Emit Jackpot if Mango wins (highest multiplier)
      if (winnerName === "mango") {
        this.io.emit('JACKPOT', {
          type: "JACKPOT",
          data: {
            userId: "user_multi",
            amount: 5000,
            symbol: "mango"
          }
        });
      }
    }

    let roundHousePayout = 0;
    const roundHouseRevenue = Object.values(this.currentRound.totals).reduce((a, b) => a + b, 0);

    const payoutPromises = roundBets.map(async (bet) => {
      const isWinner = bet.side === winnerName;
      const multiplier = this.MULTIPLIERS[bet.side] || 0;
      const payout = isWinner ? Math.floor(bet.amount * multiplier) : 0;

      if (isWinner) roundHousePayout += payout;

      const updateBet = Bet.findOneAndUpdate(
        { userId: bet.userId, roundId: bet.roundId, side: bet.side },
        { won: isWinner, payout, status: "settled" }
      );

      let updateUser = null;
      if (isWinner && payout > 0) {
        updateUser = User.findOneAndUpdate(
          { userId: bet.userId },
          { $inc: { balance: payout } }
        );
      }

      await Promise.all([updateBet, updateUser].filter(p => p !== null));

      this.updateUserCache(bet.userId, {
        amount: bet.amount,
        side: bet.side,
        won: isWinner,
        roundId: rid
      });

      const socketId = this.userIdToSocket.get(bet.userId);
      if (socketId && this.io) {
        const user = await User.findOne({ userId: bet.userId }).select('balance');
        this.io.to(socketId).emit('betResult', {
          won: isWinner,
          payout,
          balance: user ? user.balance : 0
        });
      }
    });

    await Promise.all(payoutPromises);

    this.dailyLoss += roundHousePayout;
    this.dailyProfit += roundHouseRevenue;
    await DailyStat.findOneAndUpdate(
      { date: this.currentDate },
      { $inc: { totalHouseLoss: roundHousePayout, totalHouseProfit: roundHouseRevenue } }
    );

    await new Promise(resolve => setTimeout(resolve, 5000)); // Show results for 5s

    this.currentRound = {
      roundId: uuidv4(),
      time: 60,
      status: "betting",
      bets: [],
      totals: this.SYMBOLS.reduce((acc, symbol) => ({ ...acc, [symbol]: 0 }), {})
    };
  }

  startTimer() {
    setInterval(async () => {
      if (this.currentRound.time > 0) {
        this.currentRound.time--;
        if (this.io) {
          this.io.emit('round', {
            roundId: this.currentRound.roundId,
            time: this.currentRound.time,
            status: this.currentRound.status,
            newRound: this.currentRound.time === 59,
            totals: this.currentRound.totals
          });
        }
      } else if (this.currentRound.status === "betting") {
        await this.processRoundEnd();
      }
    }, 1000);
  }

  getCurrentRound() { return this.currentRound; }

  addBetToCache(bet) {
    if (this.currentRound.status !== "betting") throw new Error("Betting is closed");
    if (this.currentRound.time <= 3) throw new Error("Too late to bet");

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
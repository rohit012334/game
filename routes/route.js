import express from 'express';
import { getWallet, register, getHistory, getCurrentRound, placeBet, getRecentResults, getRoundStats } from '../controllers/gameController.js';
import { apiLimiter, globalLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

router.post('/register', apiLimiter, register);
router.get('/wallet/:userId', globalLimiter, getWallet);
router.get('/round/current', getCurrentRound); // No limiter for polling
router.post('/bet', apiLimiter, placeBet);
router.get('/history/:userId', globalLimiter, getHistory);
router.get('/results/history', globalLimiter, getRecentResults);
router.get('/round/stats', getRoundStats); // No limiter for polling

export default router;

import express from 'express';
import {
    getWallet,
    getHistory,
    getCurrentRound,
    placeBet,
    getRecentResults,
    getRoundStats
} from '../controllers/gameController.js';
import { apiLimiter, globalLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// ❌ /register REMOVED
router.get('/wallet/:userId', globalLimiter, getWallet);     // userId = firebaseUid
router.get('/round/current', getCurrentRound);
router.post('/bet', apiLimiter, placeBet);
router.get('/history/:userId', globalLimiter, getHistory);   // userId = firebaseUid
router.get('/results/history', globalLimiter, getRecentResults);
router.get('/round/stats', getRoundStats);

export default router;
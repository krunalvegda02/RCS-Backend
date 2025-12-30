import express from 'express';
import { getDashboardStats, getRecentOrders, addWalletRequest } from '../controller/dashboard.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.get('/stats/:userId', authenticateToken, getDashboardStats);
router.get('/recent-orders/:userId', authenticateToken, getRecentOrders);
router.post('/wallet-request', authenticateToken, addWalletRequest);

export default router;
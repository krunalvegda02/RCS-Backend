import express from 'express';
import * as AuthController from '../controller/auth.controller.js';
import { authenticateToken, requireAdmin } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Public routes
router.post('/login', AuthController.login);
router.post('/register', AuthController.register);
router.post('/refresh-token', AuthController.refreshToken);

// Protected routes
router.get('/profile', authenticateToken, AuthController.getProfile);
router.put('/profile', authenticateToken, AuthController.updateProfile);
router.put('/jio-config', authenticateToken, AuthController.updateJioConfig);
router.get('/jio-config', authenticateToken, AuthController.getJioConfig);

// Admin routes
router.post('/admin/create-user', authenticateToken, requireAdmin, AuthController.createUser);
router.get('/admin/users', authenticateToken, requireAdmin, AuthController.getAllUsers);
router.put('/admin/user/:userId', authenticateToken, requireAdmin, AuthController.updateUser);
router.put('/admin/wallet/:userId', authenticateToken, requireAdmin, AuthController.updateWallet);
router.put('/admin/password/:userId', authenticateToken, requireAdmin, AuthController.updateUserPassword);
router.get('/admin/transactions/:userId', authenticateToken, requireAdmin, AuthController.getUserTransactionHistory);

export default router;
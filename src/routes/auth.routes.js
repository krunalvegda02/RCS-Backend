import express from 'express';
import * as AuthController from '../controller/auth.controller.js';
import { authenticateToken, requireAdmin } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Public routes
router.post('/login', AuthController.login);
router.post('/register', AuthController.register);

// Protected routes
router.get('/profile', authenticateToken, AuthController.getProfile);
router.put('/profile', authenticateToken, AuthController.updateProfile);

// Admin routes
router.post('/admin/create-user', authenticateToken, requireAdmin, AuthController.createUser);
router.get('/admin/users', authenticateToken, requireAdmin, AuthController.getAllUsers);
router.put('/admin/wallet/:userId', authenticateToken, requireAdmin, AuthController.updateWallet);

export default router;
import express from 'express';
import * as MessageController from '../controller/message.controller.js';
import { authenticateToken, requireUser } from '../middlewares/auth.middleware.js';
import { requireOnboarded } from '../middlewares/onboarding.middleware.js';

const router = express.Router();

router.use(authenticateToken);
router.use(requireUser);
router.use(requireOnboarded);

router.get('/', MessageController.getAll);
router.get('/stats', MessageController.getStats);
router.get('/:id', MessageController.getById);

export default router;
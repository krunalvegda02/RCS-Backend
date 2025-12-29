import express from 'express';
import * as MessageController from '../controller/message.controller.js';

const router = express.Router();

router.get('/', MessageController.getAll);
router.get('/stats', MessageController.getStats);
router.get('/:id', MessageController.getById);

export default router;
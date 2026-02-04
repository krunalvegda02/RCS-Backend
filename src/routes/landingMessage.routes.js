import express from 'express';
import { sendLandingMessage } from '../controller/landingMessage.controller.js';

const router = express.Router();

router.post('/send', sendLandingMessage);

export default router;

import express from 'express';
import * as TemplateController from '../controller/template.controller.js';
import { authenticateToken, requireUser } from '../middlewares/auth.middleware.js';
import { cacheMiddleware } from '../middlewares/cache.middleware.js';

const router = express.Router();

router.use(authenticateToken);
router.use(requireUser);

router.post('/', TemplateController.create);
router.get('/', cacheMiddleware, TemplateController.getAll);
router.get('/user/:userId', cacheMiddleware, TemplateController.getAll);
router.get('/type/:type', cacheMiddleware, TemplateController.getByType);
router.get('/:id', cacheMiddleware, TemplateController.getById);
router.put('/:id', TemplateController.update);
router.delete('/:id', TemplateController.deleteTemplate);
router.post('/:id/approve', TemplateController.approve);

export default router;

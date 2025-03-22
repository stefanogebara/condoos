import { Router } from 'express';
import { CondominiumController } from '../controllers/condominium.controller';
import { pool } from '../db/pool';

const router = Router();

// Create a new condominium
router.post('/', CondominiumController.create);

// Get all condominiums
router.get('/', CondominiumController.getAll);

// Get a specific condominium
router.get('/:id', CondominiumController.getById);

// Update a condominium
router.put('/:id', CondominiumController.update);

// Delete a condominium
router.delete('/:id', CondominiumController.delete);

export default router; 
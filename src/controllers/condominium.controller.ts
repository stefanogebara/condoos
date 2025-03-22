import { Request, Response } from 'express';
import { pool } from '../db/pool';

export class CondominiumController {
  static async create(req: Request, res: Response): Promise<void> {
    try {
      const { name, address, number_of_floors, units_per_floor, description, amenities } = req.body;

      // Validate input
      if (!name || !address || !number_of_floors || !units_per_floor) {
        res.status(400).json({ 
          message: 'Required fields missing',
          required: ['name', 'address', 'number_of_floors', 'units_per_floor']
        });
        return;
      }

      // Validate numbers
      if (number_of_floors <= 0 || units_per_floor <= 0) {
        res.status(400).json({ 
          message: 'Number of floors and units per floor must be positive numbers' 
        });
        return;
      }

      // Check if condominium with same name exists
      const existing = await pool.query(
        'SELECT * FROM condominiums WHERE name = $1',
        [name]
      );

      if (existing.rows.length > 0) {
        res.status(409).json({ message: 'A condominium with this name already exists' });
        return;
      }

      const result = await pool.query(
        `INSERT INTO condominiums 
         (name, address, number_of_floors, units_per_floor, description, amenities)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [name, address, number_of_floors, units_per_floor, description, amenities]
      );

      res.status(201).json({
        message: 'Condominium created successfully',
        condominium: result.rows[0]
      });
    } catch (error) {
      console.error('Error creating condominium:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async getAll(req: Request, res: Response): Promise<void> {
    try {
      const result = await pool.query(
        `SELECT c.*, 
         COUNT(DISTINCT u.id) as total_residents,
         COUNT(DISTINCT p.id) as total_projects
         FROM condominiums c
         LEFT JOIN users u ON c.id = u.condominium_id
         LEFT JOIN projects p ON c.id = p.condominium_id
         GROUP BY c.id
         ORDER BY c.name`
      );

      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching condominiums:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async getById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const result = await pool.query(
        `SELECT c.*, 
         COUNT(DISTINCT u.id) as total_residents,
         COUNT(DISTINCT p.id) as total_projects
         FROM condominiums c
         LEFT JOIN users u ON c.id = u.condominium_id
         LEFT JOIN projects p ON c.id = p.condominium_id
         WHERE c.id = $1
         GROUP BY c.id`,
        [id]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ message: 'Condominium not found' });
        return;
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error fetching condominium:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async update(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { name, address, number_of_floors, units_per_floor, description, amenities } = req.body;

      // Validate input
      if (!name || !address || !number_of_floors || !units_per_floor) {
        res.status(400).json({ 
          message: 'Required fields missing',
          required: ['name', 'address', 'number_of_floors', 'units_per_floor']
        });
        return;
      }

      // Validate numbers
      if (number_of_floors <= 0 || units_per_floor <= 0) {
        res.status(400).json({ 
          message: 'Number of floors and units per floor must be positive numbers' 
        });
        return;
      }

      const result = await pool.query(
        `UPDATE condominiums 
         SET name = $1, address = $2, number_of_floors = $3, 
             units_per_floor = $4, description = $5, amenities = $6,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $7
         RETURNING *`,
        [name, address, number_of_floors, units_per_floor, description, amenities, id]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ message: 'Condominium not found' });
        return;
      }

      res.json({
        message: 'Condominium updated successfully',
        condominium: result.rows[0]
      });
    } catch (error) {
      console.error('Error updating condominium:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async delete(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      // Check if condominium has any residents
      const residents = await pool.query(
        'SELECT COUNT(*) FROM users WHERE condominium_id = $1',
        [id]
      );

      if (parseInt(residents.rows[0].count) > 0) {
        res.status(400).json({ 
          message: 'Cannot delete condominium with existing residents' 
        });
        return;
      }

      const result = await pool.query(
        'DELETE FROM condominiums WHERE id = $1 RETURNING *',
        [id]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ message: 'Condominium not found' });
        return;
      }

      res.json({ message: 'Condominium deleted successfully' });
    } catch (error) {
      console.error('Error deleting condominium:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
} 
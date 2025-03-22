import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool';
import { User, UserRow, UserRole } from '../types/user';

export class AuthController {
  static async register(req: Request, res: Response): Promise<void> {
    try {
      const { email, password, firstName, lastName, role, condominiumId } = req.body;

      // Validate input
      if (!email || !password || !firstName || !lastName || !condominiumId) {
        res.status(400).json({ message: 'All fields are required' });
        return;
      }

      // Check if user already exists
      const existingUser = await pool.query(
        'SELECT * FROM users WHERE email = $1',
        [email]
      );

      if (existingUser.rows.length > 0) {
        res.status(409).json({ message: 'User already exists' });
        return;
      }

      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Create user
      const result = await pool.query<UserRow>(
        `INSERT INTO users (email, password, first_name, last_name, role, condominium_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [email, hashedPassword, firstName, lastName, role || 'resident', condominiumId]
      );

      const user = AuthController.transformUser(result.rows[0]);
      const token = AuthController.generateToken(user);

      res.status(201).json({
        message: 'User registered successfully',
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          condominiumId: user.condominiumId
        }
      });
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;

      // Validate input
      if (!email || !password) {
        res.status(400).json({ message: 'Email and password are required' });
        return;
      }

      // Find user
      const result = await pool.query<UserRow>(
        'SELECT * FROM users WHERE email = $1',
        [email]
      );

      if (result.rows.length === 0) {
        res.status(401).json({ message: 'Invalid credentials' });
        return;
      }

      const user = AuthController.transformUser(result.rows[0]);

      // Verify password
      const validPassword = await bcrypt.compare(password, result.rows[0].password);
      if (!validPassword) {
        res.status(401).json({ message: 'Invalid credentials' });
        return;
      }

      const token = AuthController.generateToken(user);

      res.json({
        message: 'Login successful',
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          condominiumId: user.condominiumId
        }
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  private static generateToken(user: User): string {
    return jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );
  }

  private static transformUser(row: UserRow): User {
    return {
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      role: row.role as UserRole,
      condominiumId: row.condominium_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
} 
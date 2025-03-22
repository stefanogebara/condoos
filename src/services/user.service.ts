import { pool } from '../db/pool';
import bcrypt from 'bcrypt';
import { User, UserRole } from '../types/user';

export class UserService {
  static async createUser(
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    role: UserRole,
    condominiumId: number
  ): Promise<User> {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await pool.query(
      `INSERT INTO users (email, password, first_name, last_name, role, condominium_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [email, hashedPassword, firstName, lastName, role, condominiumId]
    );

    return this.transformUser(result.rows[0]);
  }

  static async findByEmail(email: string): Promise<User | null> {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    return result.rows[0] ? this.transformUser(result.rows[0]) : null;
  }

  static async validatePassword(email: string, password: string): Promise<boolean> {
    const result = await pool.query(
      'SELECT password FROM users WHERE email = $1',
      [email]
    );

    if (!result.rows[0]) {
      return false;
    }

    return bcrypt.compare(password, result.rows[0].password);
  }

  static async getUsersByCondominium(condominiumId: number): Promise<User[]> {
    const result = await pool.query(
      `SELECT * FROM users WHERE condominium_id = $1`,
      [condominiumId]
    );

    return result.rows.map(this.transformUser);
  }

  private static transformUser(row: any): User {
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
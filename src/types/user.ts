export type UserRole = 'resident' | 'admin' | 'super_admin';

export interface User {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  condominiumId: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserRow {
  id: number;
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  condominium_id: number;
  created_at: Date;
  updated_at: Date;
}

export interface JWTPayload {
  userId: number;
  email: string;
  role: UserRole;
} 
import jwt from 'jsonwebtoken';

interface DecodedToken {
  userId: string;
  role: string;
  iat: number;
  exp: number;
}

export const verifyToken = async (token: string): Promise<DecodedToken> => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key') as DecodedToken;
    return decoded;
  } catch (error) {
    throw new Error('Invalid token');
  }
};

export const generateToken = (userId: string, role: string): string => {
  return jwt.sign(
    { userId, role },
    process.env.JWT_SECRET || 'your-secret-key',
    { expiresIn: '24h' }
  );
};

export const refreshToken = (token: string): string => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key') as DecodedToken;
    return generateToken(decoded.userId, decoded.role);
  } catch (error) {
    throw new Error('Invalid token');
  }
}; 
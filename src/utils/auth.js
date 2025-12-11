import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';

const SALT_ROUNDS = 10;

export async function hashPassword(password) {
  return await bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(password, hash) {
  return await bcrypt.compare(password, hash);
}

export function generateToken(payload) {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: '30d'
  });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwt.secret);
  } catch (error) {
    return null;
  }
}

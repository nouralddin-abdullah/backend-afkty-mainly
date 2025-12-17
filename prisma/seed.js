/**
 * Database Seed Script
 * Creates initial admin user and test data
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...\n');

  // Create admin user
  const adminPassword = await bcrypt.hash('admin123', 12);
  
  const admin = await prisma.admin.upsert({
    where: { email: 'admin@afkty.com' },
    update: {},
    create: {
      email: 'admin@afkty.com',
      passwordHash: adminPassword,
      name: 'Super Admin',
      role: 'SUPER_ADMIN'
    }
  });
  
  console.log('✓ Admin created:', admin.email);

  // Create a test hub (auto-approved for development)
  const hubApiKey = `hub_live_${crypto.randomBytes(24).toString('hex')}`;
  const hubApiKeyHash = crypto.createHash('sha256').update(hubApiKey).digest('hex');
  
  const hub = await prisma.hub.upsert({
    where: { slug: 'test-hub' },
    update: {},
    create: {
      name: 'Test Hub',
      slug: 'test-hub',
      ownerEmail: 'test@example.com',
      description: 'A test hub for development',
      apiKey: hubApiKey,
      apiKeyHash: hubApiKeyHash,
      apiKeyHint: '...' + hubApiKey.slice(-6),
      status: 'APPROVED',
      approvedAt: new Date(),
      approvedBy: 'system'
    }
  });
  
  console.log('✓ Test hub created:', hub.name);
  console.log('  API Key:', hubApiKey);

  // Create a test user
  const userPassword = await bcrypt.hash('test123', 12);
  const userToken = `usr_tk_${crypto.randomBytes(24).toString('hex')}`;
  const userTokenHash = crypto.createHash('sha256').update(userToken).digest('hex');
  
  const user = await prisma.user.upsert({
    where: { email: 'test@example.com' },
    update: {},
    create: {
      email: 'test@example.com',
      username: 'TestUser',
      passwordHash: userPassword,
      userToken: userToken,
      userTokenHash: userTokenHash,
      userTokenHint: '...' + userToken.slice(-6),
      status: 'ACTIVE'
    }
  });
  
  console.log('✓ Test user created:', user.email);
  console.log('  User Token:', userToken);

  console.log('\n🎉 Seeding complete!\n');
  console.log('='.repeat(60));
  console.log('TEST CREDENTIALS (for development only):');
  console.log('='.repeat(60));
  console.log('\nAdmin:');
  console.log('  Email: admin@afkty.com');
  console.log('  Password: admin123');
  console.log('\nTest User:');
  console.log('  Email: test@example.com');
  console.log('  Password: test123');
  console.log('  User Token:', userToken);
  console.log('\nTest Hub:');
  console.log('  Name:', hub.name);
  console.log('  API Key:', hubApiKey);
  console.log('='.repeat(60));
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

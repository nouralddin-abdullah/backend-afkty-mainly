import prisma from './database.js';
import crypto from 'crypto';

/**
 * Hub Service
 * Manages hub registration, API keys, and status
 */

class HubService {
  /**
   * Generate a secure API key for a hub
   */
  generateApiKey() {
    const key = `hub_live_${crypto.randomBytes(24).toString('hex')}`;
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    const hint = '...' + key.slice(-6);
    return { key, hash, hint };
  }

  /**
   * Create a slug from hub name
   */
  createSlug(name) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);
  }

  /**
   * Ensure slug is unique
   */
  async ensureUniqueSlug(baseSlug) {
    let slug = baseSlug;
    let counter = 1;
    
    while (await prisma.hub.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
    
    return slug;
  }

  /**
   * Register a new hub (application)
   */
  async registerHub({ name, ownerEmail, discordUrl, websiteUrl, description }) {
    const { key, hash, hint } = this.generateApiKey();
    const baseSlug = this.createSlug(name);
    const slug = await this.ensureUniqueSlug(baseSlug);

    const hub = await prisma.hub.create({
      data: {
        name,
        slug,
        ownerEmail,
        discordUrl,
        websiteUrl,
        description,
        apiKey: key,
        apiKeyHash: hash,
        apiKeyHint: hint,
        status: 'PENDING'
      }
    });

    return {
      hub: {
        id: hub.id,
        name: hub.name,
        slug: hub.slug,
        status: hub.status,
        createdAt: hub.createdAt
      },
      // Only returned ONCE at creation
      apiKey: key,
      apiKeyHint: hint
    };
  }

  /**
   * Validate hub API key
   * Returns hub if valid and approved, null otherwise
   */
  async validateApiKey(apiKey) {
    if (!apiKey || !apiKey.startsWith('hub_live_')) {
      return null;
    }

    const hub = await prisma.hub.findUnique({
      where: { apiKey }
    });

    if (!hub) {
      return null;
    }

    // Check status
    if (hub.status !== 'APPROVED') {
      return { error: 'HUB_NOT_APPROVED', status: hub.status };
    }

    return { hub };
  }

  /**
   * Get hub by ID
   */
  async getHubById(id) {
    return prisma.hub.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        ownerEmail: true,
        discordUrl: true,
        websiteUrl: true,
        description: true,
        status: true,
        apiKeyHint: true,
        totalConnections: true,
        createdAt: true,
        approvedAt: true
      }
    });
  }

  /**
   * Get hub by API key (for internal use)
   */
  async getHubByApiKey(apiKey) {
    return prisma.hub.findUnique({
      where: { apiKey }
    });
  }

  /**
   * Approve a hub
   */
  async approveHub(hubId, approvedBy) {
    return prisma.hub.update({
      where: { id: hubId },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        approvedBy
      }
    });
  }

  /**
   * Suspend a hub
   */
  async suspendHub(hubId, reason) {
    // Also disconnect all active sessions from this hub
    await prisma.session.updateMany({
      where: { 
        hubId,
        status: 'ACTIVE'
      },
      data: {
        status: 'DISCONNECTED',
        disconnectedAt: new Date(),
        disconnectReason: 'ERROR',
        disconnectMessage: 'Hub suspended'
      }
    });

    return prisma.hub.update({
      where: { id: hubId },
      data: {
        status: 'SUSPENDED',
        suspendedAt: new Date(),
        suspendReason: reason
      }
    });
  }

  /**
   * Reject a hub application
   */
  async rejectHub(hubId, reason) {
    return prisma.hub.update({
      where: { id: hubId },
      data: {
        status: 'REJECTED',
        suspendReason: reason
      }
    });
  }

  /**
   * Regenerate API key for a hub
   */
  async regenerateApiKey(hubId) {
    const { key, hash, hint } = this.generateApiKey();

    await prisma.hub.update({
      where: { id: hubId },
      data: {
        apiKey: key,
        apiKeyHash: hash,
        apiKeyHint: hint
      }
    });

    return { apiKey: key, apiKeyHint: hint };
  }

  /**
   * Increment connection count for hub
   */
  async incrementConnections(hubId) {
    await prisma.hub.update({
      where: { id: hubId },
      data: {
        totalConnections: { increment: 1 }
      }
    });
  }

  /**
   * List all hubs (admin)
   */
  async listHubs({ status, page = 1, limit = 20 }) {
    const where = status ? { status } : {};
    
    const [hubs, total] = await Promise.all([
      prisma.hub.findMany({
        where,
        select: {
          id: true,
          name: true,
          slug: true,
          ownerEmail: true,
          status: true,
          totalConnections: true,
          createdAt: true,
          approvedAt: true
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.hub.count({ where })
    ]);

    return { hubs, total, page, limit };
  }

  /**
   * Get hub stats
   */
  async getHubStats(hubId) {
    const [hub, activeSessions, totalSessions] = await Promise.all([
      prisma.hub.findUnique({ where: { id: hubId } }),
      prisma.session.count({ where: { hubId, status: 'ACTIVE' } }),
      prisma.session.count({ where: { hubId } })
    ]);

    return {
      totalConnections: hub?.totalConnections || 0,
      activeSessions,
      totalSessions
    };
  }
}

export default new HubService();

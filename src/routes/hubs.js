import express from 'express';
import hubService from '../services/hubService.js';

const router = express.Router();

/**
 * POST /api/v1/hubs/apply
 * Apply to register a new hub (become a partner)
 */
router.post('/apply', async (req, res) => {
  try {
    const { name, ownerEmail, discordUrl, websiteUrl, description } = req.body;

    // Validation
    if (!name || !ownerEmail) {
      return res.status(400).json({
        success: false,
        error: 'Name and owner email are required'
      });
    }

    if (name.length < 3 || name.length > 100) {
      return res.status(400).json({
        success: false,
        error: 'Hub name must be between 3 and 100 characters'
      });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(ownerEmail)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email address'
      });
    }

    const result = await hubService.registerHub({
      name,
      ownerEmail,
      discordUrl,
      websiteUrl,
      description
    });

    res.status(201).json({
      success: true,
      message: 'Hub application submitted. Your API key will work once approved.',
      hub: result.hub,
      // IMPORTANT: This is the only time the full API key is shown
      apiKey: result.apiKey,
      apiKeyHint: result.apiKeyHint,
      instructions: {
        step1: 'Save your API key securely - it will not be shown again',
        step2: 'Wait for approval (we will email you)',
        step3: 'Once approved, use the key in your SDK: hubKey = "' + result.apiKey.substring(0, 20) + '..."'
      }
    });
  } catch (error) {
    console.error('Hub registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to register hub'
    });
  }
});

/**
 * GET /api/v1/hubs/:slug
 * Get public hub info
 */
router.get('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;

    const hub = await hubService.getHubBySlug?.(slug);
    
    if (!hub) {
      return res.status(404).json({
        success: false,
        error: 'Hub not found'
      });
    }

    res.json({
      success: true,
      hub: {
        name: hub.name,
        slug: hub.slug,
        description: hub.description,
        discordUrl: hub.discordUrl,
        websiteUrl: hub.websiteUrl
      }
    });
  } catch (error) {
    console.error('Error fetching hub:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch hub'
    });
  }
});

/**
 * POST /api/v1/hubs/validate
 * Validate a hub API key (for debugging/testing)
 */
router.post('/validate', async (req, res) => {
  try {
    const { apiKey } = req.body;

    if (!apiKey) {
      return res.status(400).json({
        success: false,
        error: 'API key is required'
      });
    }

    const result = await hubService.validateApiKey(apiKey);

    if (!result) {
      return res.json({
        success: false,
        valid: false,
        error: 'Invalid API key'
      });
    }

    if (result.error) {
      return res.json({
        success: false,
        valid: false,
        error: result.error,
        status: result.status
      });
    }

    res.json({
      success: true,
      valid: true,
      hub: {
        name: result.hub.name,
        status: result.hub.status
      }
    });
  } catch (error) {
    console.error('Error validating hub:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate hub'
    });
  }
});

export default router;

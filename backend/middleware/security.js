/**
 * Security middleware for OWASP headers and other security measures
 */

function securityHeaders(req, res, next) {
  // OWASP Security Headers (required by Zoom Apps)
  // Note: Only apply HSTS in production with HTTPS
  
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Content Security Policy - More permissive for development
  // Read ngrok URL from environment variable
  const publicUrl = process.env.PUBLIC_URL || 'http://localhost:3001';
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'self' http://localhost:* ${publicUrl}; ` +
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://appssdk.zoom.us http://localhost:*; ` +
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com http://localhost:*; ` +
    `font-src 'self' https://fonts.gstatic.com data:; ` +
    `connect-src 'self' https://*.zoom.us wss://*.zoom.us http://localhost:* ws://localhost:* ${publicUrl}; ` +
    `img-src 'self' data: https: http://localhost:*; ` +
    `frame-ancestors 'self' https://*.zoom.us https://applications.zoom.us;`
  );

  // X-Frame-Options - Allow Zoom to embed
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  next();
}

/**
 * Validate Zoom webhook signature
 */
function validateZoomWebhook(req, res, next) {
  // Webhook validation will be implemented in webhook routes
  next();
}

module.exports = {
  securityHeaders,
  validateZoomWebhook
};

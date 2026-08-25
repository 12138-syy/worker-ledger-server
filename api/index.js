// Vercel Serverless Function entry.
// Exports the Express app so Vercel serves it at /api/*.
const { createApp } = require('../app');
module.exports = createApp();

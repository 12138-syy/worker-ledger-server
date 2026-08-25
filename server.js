// Local development entry point.
const { createApp } = require('./app');
const PORT = process.env.PORT || 3000;
createApp().listen(PORT, () => {
  console.log(`Worker Ledger Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

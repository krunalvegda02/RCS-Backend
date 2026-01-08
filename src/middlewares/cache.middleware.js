const cache = new Map();
const CACHE_TTL = 10000; // 10 seconds

export const cacheMiddleware = (req, res, next) => {
  if (req.method !== 'GET') return next();
  
  const key = req.originalUrl;
  const cached = cache.get(key);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return res.json(cached.data);
  }
  
  const originalJson = res.json.bind(res);
  res.json = (data) => {
    cache.set(key, { data, timestamp: Date.now() });
    return originalJson(data);
  };
  
  next();
};

// Clear cache periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      cache.delete(key);
    }
  }
}, 30000);

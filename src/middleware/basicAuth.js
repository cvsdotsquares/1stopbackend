const VALID_TOKEN = '4lCBbMxPvSBXOYWSej8WAEdl3ZRE0v8O4Y6WMTXLSc100H1xjt';

const basicAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return res.status(401).json({ message: 'Authorization header missing or invalid' });
  }

  const base64Token = authHeader.substring(6);
  const decodedToken = Buffer.from(base64Token, 'base64').toString('utf-8');

  if (decodedToken !== VALID_TOKEN) {
    return res.status(401).json({ message: 'Invalid authorization token' });
  }

  next();
};

module.exports = basicAuth;

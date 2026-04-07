const VALID_TOKEN = '4lCBbMxPvSBXOYWSej8WAEdl3ZRE0v8O4Y6WMTXLSc100H1xjt';

const basicAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    console.log('Auth failed: missing or invalid header');
    return res.status(401).json({ message: 'Authorization header missing or invalid' });
  }

  const base64Token = authHeader.substring(6).trim();
  const decodedToken = Buffer.from(base64Token, 'base64').toString('utf-8');

  const tokenToCheck = decodedToken.endsWith(':')
    ? decodedToken.slice(0, -1)
    : decodedToken;

  if (tokenToCheck !== Buffer.from(VALID_TOKEN, 'base64').toString('utf-8')) {
    console.log('Auth failed: invalid token');
    return res.status(401).json({ message: 'Invalid authorization token' });
  }

  console.log('Auth passed');
  next();
};

module.exports = basicAuth;

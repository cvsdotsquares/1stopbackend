const path = require('path');
const dotenv = require('dotenv');

const rootDir = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(rootDir, '.env') });
dotenv.config({
  path: path.join(rootDir, '.env.local'),
  override: true,
});

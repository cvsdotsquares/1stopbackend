# 🚀 1Stop Training - Backend API

A robust Node.js Express API serving the 1Stop Training website with CMS functionality, course management, and booking system.

## 📋 Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Setup](#environment-setup)
- [Running the Application](#running-the-application)
- [API Documentation](#api-documentation)
- [Database Schema](#database-schema)
- [Docker Setup](#docker-setup)
- [Testing](#testing)
- [Deployment](#deployment)
- [Contributing](#contributing)

## ✨ Features

- **CMS API**: Content management for pages, menus, and navigation
- **Course Management**: Training courses and services API
- **Testimonials System**: Customer reviews and feedback
- **Booking System**: Course booking and scheduling
- **Contact Forms**: Lead generation and inquiries
- **Statistics API**: Dynamic stats and numbers display
- **Search & Filter**: Course search and filtering capabilities
- **Authentication**: JWT-based user authentication
- **File Upload**: Image and document upload handling
- **Email Integration**: Automated email notifications

## 🛠 Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: MySQL 8.0
- **ORM**: Native MySQL queries
- **Authentication**: JSON Web Tokens (JWT)
- **File Upload**: Multer
- **Email**: Nodemailer
- **Validation**: Joi/Express Validator
- **Security**: Helmet, CORS
- **Environment**: dotenv
- **Process Manager**: PM2
- **Containerization**: Docker

## 📦 Prerequisites

Before running this project, make sure you have:

- Node.js 18+ installed
- MySQL 8.0+ running
- npm or yarn package manager
- Git for version control

## 🚀 Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/cvsdotsquares/1stop-backend.git
   cd 1stop-backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up the database**
   ```bash
   # Import the database schema
   mysql -u root -p < stopinst_db.sql
   ```

## ⚙️ Environment Setup

Create a `.env` file in the root directory:

```env
# Server Configuration
NODE_ENV=development
PORT=5000
HOST=localhost

# Database Configuration
DB_HOST=localhost
DB_PORT=3306
DB_NAME=1stop_db
DB_USER=your_db_user
DB_PASSWORD=your_db_password

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRE=7d

# Email Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# File Upload
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=5242880

# Frontend URL (for CORS)
FRONTEND_URL=http://localhost:3000

# API Rate Limiting
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW=900000
```

## 🏃‍♂️ Running the Application

### Development Mode
```bash
# Start with nodemon (auto-restart)
npm run dev

# Start with node
npm start
```

### Production Mode
```bash
# Build and start
npm run build
npm run start:prod

# Using PM2
npm install -g pm2
pm2 start ecosystem.config.js
```

### Docker Mode
```bash
# Build and run with Docker
docker build -t 1stop-backend .
docker run -p 5000:5000 1stop-backend

# Using Docker Compose
docker-compose up -d
```

## 📡 API Documentation

### Base URL
- Development: `http://localhost:5000/api`
- Production: `https://api.1stoptraining.com/api`

### Available Endpoints

#### **CMS & Content**
```
GET    /api/cms/menu              # Get navigation menu
GET    /api/cms/pages             # Get all CMS pages
GET    /api/cms/pages/:id         # Get specific page
POST   /api/cms/pages             # Create new page (Admin)
PUT    /api/cms/pages/:id         # Update page (Admin)
DELETE /api/cms/pages/:id         # Delete page (Admin)
```

#### **Courses & Services**
```
GET    /api/courses               # Get all courses
GET    /api/courses/featured      # Get featured courses
GET    /api/courses/:id           # Get specific course
GET    /api/services              # Get all services
POST   /api/courses               # Create course (Admin)
PUT    /api/courses/:id           # Update course (Admin)
```

#### **Testimonials**
```
GET    /api/cms/testimonials      # Get testimonials
POST   /api/cms/testimonials      # Add testimonial
PUT    /api/cms/testimonials/:id  # Update testimonial (Admin)
DELETE /api/cms/testimonials/:id  # Delete testimonial (Admin)
```

#### **Bookings**
```
GET    /api/bookings              # Get all bookings (Admin)
GET    /api/bookings/:id          # Get specific booking
POST   /api/bookings              # Create new booking
PUT    /api/bookings/:id/status   # Update booking status (Admin)
```

#### **Contact & Forms**
```
POST   /api/contact/inquiry       # Submit contact form
POST   /api/contact/quote         # Request quote
GET    /api/contact/inquiries     # Get all inquiries (Admin)
```

#### **Statistics**
```
GET    /api/cms/statistics        # Get dashboard statistics
GET    /api/cms/hero-content      # Get hero section content
```

#### **Authentication**
```
POST   /api/auth/login            # Admin login
POST   /api/auth/logout           # Admin logout
GET    /api/auth/me               # Get current user
```

### Response Format
```json
{
  "success": true,
  "data": {},
  "message": "Success message",
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 100,
    "totalPages": 10
  }
}
```

### Error Response
```json
{
  "success": false,
  "error": "Error message",
  "details": "Detailed error information"
}
```

## 🗄️ Database Schema

### Key Tables
- `cms_pages` - CMS pages and navigation
- `courses` - Training courses
- `testimonials` - Customer reviews
- `bookings` - Course bookings
- `contact_inquiries` - Contact form submissions
- `users` - Admin users
- `statistics` - Dashboard statistics

### Relationships
- Pages have hierarchical parent-child relationships
- Courses can have multiple bookings
- Bookings reference courses and customers

## 🐳 Docker Setup

### Dockerfile
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 5000
CMD ["npm", "start"]
```

### Docker Compose
```yaml
version: '3.8'
services:
  api:
    build: .
    ports:
      - "5000:5000"
    environment:
      - NODE_ENV=production
    depends_on:
      - database
  database:
    image: mysql:8.0
    environment:
      MYSQL_DATABASE: 1stop_db
    volumes:
      - ./stopinst_db.sql:/docker-entrypoint-initdb.d/init.sql
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- --grep "API tests"

# Run integration tests
npm run test:integration
```

### Test Structure
```
tests/
├── unit/           # Unit tests
├── integration/    # Integration tests
├── fixtures/       # Test data
└── helpers/        # Test utilities
```

## 🚀 Deployment

### Production Checklist
- [ ] Environment variables configured
- [ ] Database migrations run
- [ ] SSL certificates installed
- [ ] Reverse proxy configured (Nginx)
- [ ] PM2 process manager setup
- [ ] Logging configured
- [ ] Backup strategy implemented
- [ ] Monitoring setup (optional)

### Deployment Commands
```bash
# Build for production
npm run build

# Start with PM2
pm2 start ecosystem.config.js --env production

# Deploy with Git hooks
git push production main
```

### Platforms
- **VPS**: DigitalOcean, AWS EC2, Linode
- **PaaS**: Railway, Render, Heroku
- **Serverless**: Vercel Functions, Netlify Functions

## 📊 Monitoring & Logging

### PM2 Monitoring
```bash
# View running processes
pm2 list

# View logs
pm2 logs

# View monitoring dashboard
pm2 monit

# Restart application
pm2 restart all
```

### Log Files
- `logs/error.log` - Error logs
- `logs/access.log` - Access logs
- `logs/app.log` - Application logs

## 🔒 Security

- JWT authentication for admin routes
- Rate limiting on API endpoints
- CORS configuration for frontend domains
- Input validation and sanitization
- SQL injection prevention
- File upload restrictions
- Security headers with Helmet

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Style
- Use ESLint configuration
- Follow Prettier formatting
- Write tests for new features
- Update documentation

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 📞 Support

- **Email**: support@1stoptraining.com
- **Documentation**: [API Docs](https://api.1stoptraining.com/docs)
- **Issues**: [GitHub Issues](https://github.com/cvsdotsquares/1stop-backend/issues)

## 🚀 Recent Updates

- ✅ CMS API endpoints implemented
- ✅ Testimonials system with pagination
- ✅ Menu and navigation API
- ✅ Docker configuration added
- 🔄 Booking system in development
- 🔄 Authentication system implementation

---

**Built with ❤️ by the 1Stop Training Team**
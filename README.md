# Condo Management System

A modern web application for managing condominiums, built with React, Node.js, and PostgreSQL.

## Features

- User authentication (Admin and Resident roles)
- Condominium management
- Project proposal and voting system
- Real-time notifications
- Responsive design with Tailwind CSS

## Tech Stack

- Frontend:
  - React
  - TypeScript
  - Tailwind CSS
  - Axios

- Backend:
  - Node.js
  - Express
  - TypeScript
  - PostgreSQL

## Prerequisites

- Node.js (v14 or higher)
- PostgreSQL (v12 or higher)
- npm or yarn

## Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/condoproject.git
cd condoproject
```

2. Install backend dependencies:
```bash
npm install
```

3. Install frontend dependencies:
```bash
cd client
npm install
```

4. Set up the database:
- Create a PostgreSQL database named 'condo_db'
- Run the schema.sql file in src/db/schema.sql

5. Configure environment variables:
- Create a .env file in the root directory with the following variables:
```
DB_HOST=localhost
DB_PORT=5433
DB_NAME=condo_db
DB_USER=postgres
DB_PASSWORD=your_password
JWT_SECRET=your_jwt_secret
```

6. Start the backend server:
```bash
npm run dev
```

7. Start the frontend development server:
```bash
cd client
npm start
```

The application will be available at:
- Frontend: http://localhost:3001
- Backend: http://localhost:3000

## Project Structure

```
condoproject/
├── client/                 # Frontend React application
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── context/       # React context providers
│   │   └── App.tsx        # Main application component
│   └── package.json
├── src/
│   ├── controllers/       # Backend controllers
│   ├── routes/           # API routes
│   ├── db/              # Database configuration
│   └── server.ts        # Main server file
└── package.json
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details. 
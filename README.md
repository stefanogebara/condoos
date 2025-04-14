# Condo Management System

A full-stack application for managing condominium properties, built with React, TypeScript, and Node.js.

## Features

- User authentication with Clerk
- Role-based access control
- Company and resident management
- Property management
- Maintenance request tracking

## Tech Stack

- Frontend: React, TypeScript, TailwindCSS
- Backend: Node.js, Express, TypeScript
- Authentication: Clerk
- Database: (To be implemented)

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Clerk account for authentication

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/condo-management.git
cd condo-management
```

2. Install dependencies:
```bash
# Install server dependencies
cd server
npm install

# Install client dependencies
cd ../client
npm install
```

3. Set up environment variables:
- Create a `.env` file in the server directory
- Add your Clerk secret key and other configuration

4. Start the development servers:
```bash
# Start the backend server
cd server
npm run dev

# Start the frontend development server
cd ../client
npm start
```

## Project Structure

```
condo-management/
├── client/                 # React frontend
├── server/                 # Node.js backend
├── .gitignore
└── README.md
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details. 
import React from 'react';
import { Link } from 'react-router-dom';

const Home: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center">
      <h1 className="text-4xl font-bold text-gray-800 mb-8">Welcome to Condo Management System</h1>
      <div className="flex gap-8">
        <Link
          to="/login"
          className="px-8 py-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Login
        </Link>
        <Link
          to="/dashboard"
          className="px-8 py-4 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
        >
          Dashboard
        </Link>
      </div>
    </div>
  );
};

export default Home;
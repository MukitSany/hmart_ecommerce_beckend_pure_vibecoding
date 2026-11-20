// const mongoose = require('mongoose');

// module.exports = async function connectDB() {
//   try {
//     const uri = process.env.MONGO_URI;

//     if (!uri) {
//       throw new Error('MONGO_URI is missing from .env');
//     }

//     await mongoose.connect(uri, {
//       serverSelectionTimeoutMS: 10000
//     });

//     console.log('MongoDB Atlas connected successfully');
//     console.log('Database:', mongoose.connection.name);

//   } catch (error) {
//     console.error('MongoDB connection failed:', error.message);
//     throw error;
//   }
// };


//2nd update for vercel deployment


const mongoose = require("mongoose");

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = {
    conn: null,
    promise: null,
  };
}

async function connectDB() {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const uri = process.env.MONGO_URI;

    if (!uri) {
      throw new Error("MONGO_URI is missing from environment variables");
    }

    cached.promise = mongoose
      .connect(uri, {
        serverSelectionTimeoutMS: 10000,
      })
      .then((mongooseInstance) => mongooseInstance)
      .catch((error) => {
        cached.promise = null;
        throw error;
      });
  }

  cached.conn = await cached.promise;

  console.log("MongoDB connected successfully");

  return cached.conn;
}

module.exports = connectDB;
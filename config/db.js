const mongoose = require("mongoose");

async function connectDB() {
  try {
    const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/imgtoolkit";
    await mongoose.connect(uri);
    console.log("✅ MongoDB connected:", uri);
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    console.error("   Server will keep running, but history/stats won't be saved.");
  }
}

module.exports = connectDB;

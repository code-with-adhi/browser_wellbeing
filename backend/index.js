// index.js

// Load environment variables from a .env file
require("dotenv").config();

// Import necessary libraries
const express = require("express");
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");

// Initialize Express app and set the port
const app = express();
const PORT = process.env.PORT || 3000;

// Set the number of salt rounds for password hashing
const saltRounds = 10;

// This is your "guest list" of allowed websites.
const whitelist = [
  // This will be filled in later when you deploy your dashboard frontend.
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow if the origin is in our whitelist (for the future dashboard)
    if (whitelist.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    }
    // OR, automatically allow any request coming from a Chrome Extension
    else if (origin && origin.startsWith("chrome-extension://")) {
      callback(null, true);
    }
    // Otherwise, block the request
    else {
      callback(new Error("This origin is not allowed by CORS"));
    }
  },
};

// Use the CORS middleware with your custom options
app.use(cors(corsOptions));

// Middleware to parse JSON bodies from incoming requests
app.use(express.json());

// ----------------------------------------------------------------------
// Database Connection Pool
// ----------------------------------------------------------------------
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// A simple function to test the database connection when the server starts
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log("Database connection successful! 🚀");
    connection.release();
  } catch (err) {
    console.error("Database connection failed:", err);
  }
}
testConnection();

// ----------------------------------------------------------------------
// JWT Authentication Middleware
// ----------------------------------------------------------------------
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (token == null) {
    return res.status(401).json({ error: "Authentication token is required" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: "Invalid or expired token" });
    }
    req.user = user;
    next();
  });
};

// ----------------------------------------------------------------------
// API Routes
// ----------------------------------------------------------------------

// Root endpoint to check if the server is running
app.get("/", (req, res) => {
  res.send("Welcome to the Browser Wellbeing Tracker API!");
});

// Registration route: POST /register
app.post("/register", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res
      .status(400)
      .json({ error: "Username and password are required" });
  }

  try {
    const [existingUser] = await pool.query(
      "SELECT id FROM users WHERE username = ?",
      [username]
    );
    if (existingUser.length > 0) {
      return res.status(409).json({ error: "Username already exists" });
    }

    const password_hash = await bcrypt.hash(password, saltRounds);

    const [result] = await pool.query(
      "INSERT INTO users (username, password_hash) VALUES (?, ?)",
      [username, password_hash]
    );

    res.status(201).json({
      message: "User registered successfully",
      userId: result.insertId,
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Login route: POST /login
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res
      .status(400)
      .json({ error: "Username and password are required" });
  }

  try {
    const [users] = await pool.query("SELECT * FROM users WHERE username = ?", [
      username,
    ]);
    const user = users[0];

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: "700h",
    });

    res.status(200).json({ message: "Login successful", token });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Protected route to receive time-tracking data and save it to the database
app.post("/track", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { website_url, website_title, total_time_seconds } = req.body; // <-- Receive title here
  const visit_date = new Date().toISOString().slice(0, 10);

  if (!website_url || total_time_seconds === undefined) {
    return res
      .status(400)
      .json({ error: "Missing website_url or total_time_seconds" });
  }

  try {
    const query = `
      INSERT INTO time_tracking (user_id, website_url, website_title, visit_date, total_time_seconds)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE total_time_seconds = total_time_seconds + ?
    `;
    const values = [
      userId,
      website_url,
      website_title,
      visit_date,
      total_time_seconds,
      total_time_seconds,
    ];

    await pool.query(query, values);
    res.status(200).json({ message: "Data saved successfully" });
  } catch (error) {
    console.error("Error saving time-tracking data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----------------------------------------------------------------------
// Start the Server
// ----------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

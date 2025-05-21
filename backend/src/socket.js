const { Server } = require("socket.io")
const http = require("http")
const express = require("express")

// Create Express app and HTTP server
const app = express()
const server = http.createServer(app)

// Initialize Socket.IO with CORS configuration
const io = new Server(server, {
  cors: {
    origin: "*", // In production, restrict this to your app's domain
    methods: ["GET", "POST"],
    allowedHeaders: ["Authorization"],
    credentials: true,
  },
})

// Authentication middleware for socket connections
io.use((socket, next) => {
  const token = socket.handshake.auth.token
  if (!token) {
    return next(new Error("Authentication error"))
  }

  // In a real app, verify the token here
  // For example: verifyJWT(token)

  // Attach user info to the socket
  socket.userId = "admin" // This would come from the token verification
  next()
})

// Handle socket connections
io.on("connection", (socket) => {
  console.log(`User connected: ${socket.userId}`)

  // Join admin room if user is admin
  if (socket.userId === "admin") {
    socket.join("admin-room")
  }

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.userId}`)
  })
})

// Function to emit new order event
const emitNewOrder = (orderId) => {
  io.to("admin-room").emit("new-order", orderId)
}

// Start the server
const PORT = process.env.SOCKET_PORT || 3001
server.listen(PORT, () => {
  console.log(`Socket.IO server running on port ${PORT}`)
})

module.exports = { io, emitNewOrder }

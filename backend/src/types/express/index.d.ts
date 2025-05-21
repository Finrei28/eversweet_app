// src/types/express/index.d.ts
import { Socket } from "socket.io"
import { Server as IOServer } from "socket.io"

declare global {
  namespace Express {
    interface Request {
      io: IOServer
    }
  }
}

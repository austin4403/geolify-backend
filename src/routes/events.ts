import { Router, Request, Response } from "express";
import { db } from "../db";
import { liveLocations, projectMessages, projects } from "../db/schema";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { requireProjectRole, requireAuth } from "../middleware/auth";

const router = Router();

// In-Memory Project SSE Connection Hub: projectId -> Set<Response>
const projectClients: Map<number, Set<Response>> = new Map();
const MAX_CLIENTS_PER_PROJECT = 50;

// Periodic Heartbeat to keep SSE connections alive and purge dead sockets
const HEARTBEAT_INTERVAL_MS = 25000;
setInterval(() => {
  projectClients.forEach((clients, projectId) => {
    const deadClients: Response[] = [];
    clients.forEach((res) => {
      try {
        res.write(`event: heartbeat\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`);
      } catch {
        deadClients.push(res);
      }
    });

    deadClients.forEach((res) => clients.delete(res));
    if (clients.size === 0) {
      projectClients.delete(projectId);
    }
  });
}, HEARTBEAT_INTERVAL_MS);

// Helper to broadcast event to all connected teammates in a project
export function broadcastProjectEvent(projectId: number, eventName: string, data: Record<string, any>) {
  const clients = projectClients.get(projectId);
  if (!clients || clients.size === 0) return;

  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  const deadClients: Response[] = [];

  clients.forEach((res) => {
    try {
      res.write(payload);
    } catch {
      deadClients.push(res);
    }
  });

  deadClients.forEach((res) => clients.delete(res));
  if (clients.size === 0) {
    projectClients.delete(projectId);
  }
}

const pingLocationSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  userName: z.string().min(1, "User name is required"),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  elevation: z.number().optional(),
  batteryLevel: z.number().min(0).max(100).optional(),
});

const sendMessageSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  senderName: z.string().min(1, "Sender name is required"),
  message: z.string().min(1, "Message cannot be empty").max(2000, "Message exceeds 2000 characters limit"),
  metadata: z.record(z.string(), z.any()).optional(),
});

// 1. GET /api/projects/:projectId/events - Connect to Project-Scoped Live SSE Stream
router.get(
  "/projects/:projectId/events",
  requireProjectRole("viewer"),
  (req: Request, res: Response) => {
    const rawId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
    const projectId = parseInt(rawId, 10);

    if (isNaN(projectId)) {
      res.status(400).json({ error: "Invalid project ID" });
      return;
    }

    if (!projectClients.has(projectId)) {
      projectClients.set(projectId, new Set());
    }

    const currentPool = projectClients.get(projectId)!;
    if (currentPool.size >= MAX_CLIENTS_PER_PROJECT) {
      res.status(429).json({ error: "Maximum concurrent live viewers reached for this project." });
      return;
    }

    // Set SSE Headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable proxy buffering (Nginx / Cloudflare)
    res.flushHeaders();

    currentPool.add(res);

    // Send initial connection confirmation
    res.write(
      `event: connected\ndata: ${JSON.stringify({
        status: "connected",
        projectId,
        timestamp: new Date().toISOString(),
        activeTeammates: currentPool.size,
      })}\n\n`
    );

    // Clean up on disconnect
    const cleanup = () => {
      const clients = projectClients.get(projectId);
      if (clients) {
        clients.delete(res);
        if (clients.size === 0) {
          projectClients.delete(projectId);
        }
      }
    };

    req.on("close", cleanup);
    req.on("end", cleanup);
    res.on("error", cleanup);
  }
);

// 2. POST /api/projects/:projectId/ping-location - Geologist broadcasts live GPS coordinates
router.post(
  "/projects/:projectId/ping-location",
  requireProjectRole("editor"),
  async (req: Request, res: Response) => {
    try {
      const rawId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
      const projectId = parseInt(rawId, 10);

      if (isNaN(projectId)) {
        res.status(400).json({ error: "Invalid project ID" });
        return;
      }

      const validated = pingLocationSchema.parse(req.body);

      // Upsert into live_locations
      const existing = await db
        .select({ id: liveLocations.id })
        .from(liveLocations)
        .where(eq(liveLocations.userId, validated.userId))
        .limit(1);

      let record;
      if (existing.length > 0) {
        [record] = await db
          .update(liveLocations)
          .set({
            ...validated,
            projectId,
            updatedAt: new Date(),
          })
          .where(eq(liveLocations.id, existing[0].id))
          .returning();
      } else {
        [record] = await db
          .insert(liveLocations)
          .values({
            ...validated,
            projectId,
          })
          .returning();
      }

      // Broadcast instant GPS pin update to all team dashboard maps
      broadcastProjectEvent(projectId, "member_location_updated", record);

      res.json({ status: "broadcasted", data: record });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.issues });
        return;
      }
      res.status(500).json({ error: error.message });
    }
  }
);

// 3. GET /api/projects/:projectId/live-locations - Get latest locations of all team members
router.get(
  "/projects/:projectId/live-locations",
  requireProjectRole("viewer"),
  async (req: Request, res: Response) => {
    try {
      const rawId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
      const projectId = parseInt(rawId, 10);

      if (isNaN(projectId)) {
        res.status(400).json({ error: "Invalid project ID" });
        return;
      }

      const locations = await db
        .select()
        .from(liveLocations)
        .where(eq(liveLocations.projectId, projectId));

      res.json({ data: locations });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

// 4. POST /api/projects/:projectId/messages - Send team field chat message
router.post(
  "/projects/:projectId/messages",
  requireProjectRole("editor"),
  async (req: Request, res: Response) => {
    try {
      const rawId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
      const projectId = parseInt(rawId, 10);

      if (isNaN(projectId)) {
        res.status(400).json({ error: "Invalid project ID" });
        return;
      }

      const validated = sendMessageSchema.parse(req.body);

      const [newMessage] = await db
        .insert(projectMessages)
        .values({
          projectId,
          userId: validated.userId,
          senderName: validated.senderName,
          message: validated.message,
          metadata: validated.metadata || {},
        })
        .returning();

      // Broadcast new message instantly to team chat screens via SSE
      broadcastProjectEvent(projectId, "new_message", newMessage);

      res.status(201).json({ data: newMessage });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.issues });
        return;
      }
      res.status(500).json({ error: error.message });
    }
  }
);

// 5. GET /api/projects/:projectId/messages - Fetch team chat history
router.get(
  "/projects/:projectId/messages",
  requireProjectRole("viewer"),
  async (req: Request, res: Response) => {
    try {
      const rawId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
      const projectId = parseInt(rawId, 10);

      if (isNaN(projectId)) {
        res.status(400).json({ error: "Invalid project ID" });
        return;
      }

      const messages = await db
        .select()
        .from(projectMessages)
        .where(eq(projectMessages.projectId, projectId))
        .orderBy(desc(projectMessages.createdAt))
        .limit(100);

      res.json({ data: messages.reverse() });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

export default router;

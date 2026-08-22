import { Router, Request, Response } from "express";
import { db } from "../db";
import { projects, projectCollaborators } from "../db/schema";
import { z } from "zod";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth, requireProjectRole } from "../middleware/auth";

const router = Router();

const createProjectSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  name: z.string().min(1, "Project name is required").max(200, "Project name too long"),
  projectType: z.enum([
    "field_mapping",
    "hydrogeology",
    "petroleum",
    "mining",
    "geotechnical",
  ]),
  description: z.string().max(2000).optional(),
  clientOrOrg: z.string().max(200).optional(),
  status: z.enum(["planning", "in_progress", "completed", "archived"]).default("in_progress"),
  budgetEstimated: z.number().nonnegative().optional(),
  budgetCurrency: z.string().max(10).default("KES"),
  bounds: z
    .object({
      minLat: z.number().min(-90).max(90).optional(),
      maxLat: z.number().min(-90).max(90).optional(),
      minLng: z.number().min(-180).max(180).optional(),
      maxLng: z.number().min(-180).max(180).optional(),
      polygonGeoJson: z.record(z.string(), z.any()).optional(),
    })
    .optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

const updateProjectSchema = createProjectSchema.partial();

const inviteCollaboratorSchema = z.object({
  userId: z.string().min(1, "User ID to invite is required"),
  role: z.enum(["owner", "editor", "viewer"]).default("editor"),
});

// 1. GET /api/projects - List projects accessible to current user (or filtered by user)
router.get("/", async (req: Request, res: Response) => {
  try {
    const searchQuery = req.query.q as string | undefined;
    const typeFilter = req.query.type as string | undefined;
    const currentUserId = (req.query.userId as string) || req.user?.userId || (req.headers["x-user-id"] as string);

    let allProjects = await db.query.projects.findMany({
      orderBy: desc(projects.createdAt),
      with: {
        collaborators: true,
      },
    });

    if (typeFilter) {
      allProjects = allProjects.filter((p) => p.projectType === typeFilter);
    }

    if (currentUserId) {
      allProjects = allProjects.filter(
        (p) => p.userId === currentUserId || p.collaborators.some((c) => c.userId === currentUserId)
      );
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      allProjects = allProjects.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description?.toLowerCase().includes(q) ||
          p.clientOrOrg?.toLowerCase().includes(q)
      );
    }

    res.json({ data: allProjects });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 2. GET /api/projects/:id - Get project details (enforces viewer RBAC)
router.get("/:id", requireProjectRole("viewer"), async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid project ID" });
      return;
    }

    const project = await db.query.projects.findFirst({
      where: eq(projects.id, id),
      with: {
        collaborators: true,
        stations: {
          with: {
            rockSamples: true,
            structuralMeasurements: true,
          },
        },
        boreholes: true,
      },
    });

    if (!project) {
      res.status(404).json({ error: `Project #${id} not found` });
      return;
    }

    res.json({ data: project });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3. POST /api/projects - Create a new project (requires authentication)
router.post("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const validatedData = createProjectSchema.parse(req.body);

    const [newProject] = await db
      .insert(projects)
      .values(validatedData)
      .returning();

    // Automatically add creator as owner in collaborators table
    await db.insert(projectCollaborators).values({
      projectId: newProject.id,
      userId: newProject.userId,
      role: "owner",
    });

    res.status(201).json({ data: newProject });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

// 4. PATCH /api/projects/:id - Update a project (requires editor or owner role)
router.patch("/:id", requireProjectRole("editor"), async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid project ID" });
      return;
    }

    const validatedUpdates = updateProjectSchema.parse(req.body);

    const [updatedProject] = await db
      .update(projects)
      .set({
        ...validatedUpdates,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id))
      .returning();

    if (!updatedProject) {
      res.status(404).json({ error: `Project #${id} not found` });
      return;
    }

    res.json({ data: updatedProject });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

// 5. POST /api/projects/:id/collaborators - Invite/Share project (requires owner role)
router.post("/:id/collaborators", requireProjectRole("owner"), async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid project ID" });
      return;
    }

    const validated = inviteCollaboratorSchema.parse(req.body);

    // Check if already invited
    const existing = await db
      .select({ id: projectCollaborators.id })
      .from(projectCollaborators)
      .where(
        and(
          eq(projectCollaborators.projectId, id),
          eq(projectCollaborators.userId, validated.userId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      // Update role
      const [updated] = await db
        .update(projectCollaborators)
        .set({ role: validated.role })
        .where(eq(projectCollaborators.id, existing[0].id))
        .returning();
      res.json({ data: updated, message: "Collaborator role updated" });
      return;
    }

    const [collaborator] = await db
      .insert(projectCollaborators)
      .values({
        projectId: id,
        userId: validated.userId,
        role: validated.role,
      })
      .returning();

    res.status(201).json({ data: collaborator });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

// 6. DELETE /api/projects/:id - Delete project (requires owner role)
router.delete("/:id", requireProjectRole("owner"), async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid project ID" });
      return;
    }

    const [deletedProject] = await db
      .delete(projects)
      .where(eq(projects.id, id))
      .returning();

    if (!deletedProject) {
      res.status(404).json({ error: `Project #${id} not found` });
      return;
    }

    res.json({ message: `Project #${id} (${deletedProject.name}) deleted successfully` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

import { Router, Request, Response } from "express";
import { db } from "../db";
import { projects, projectCollaborators, userProfiles, stations, boreholes } from "../db/schema";
import { z } from "zod";
import { eq, desc, or, ilike } from "drizzle-orm";

const router = Router();

const createProjectSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  name: z.string().min(1, "Project name is required"),
  projectType: z.enum([
    "field_mapping",
    "hydrogeology",
    "petroleum",
    "mining",
    "geotechnical",
  ]),
  description: z.string().optional(),
  clientOrOrg: z.string().optional(),
  status: z.enum(["planning", "in_progress", "completed", "archived"]).default("in_progress"),
  budgetEstimated: z.number().nonnegative().optional(),
  budgetCurrency: z.string().default("KES"),
  bounds: z
    .object({
      minLat: z.number().optional(),
      maxLat: z.number().optional(),
      minLng: z.number().optional(),
      maxLng: z.number().optional(),
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

// 1. GET /api/projects - List projects (with search and domain filter)
router.get("/", async (req: Request, res: Response) => {
  try {
    const searchQuery = req.query.q as string | undefined;
    const typeFilter = req.query.type as string | undefined;
    const userId = req.query.userId as string | undefined;

    let allProjects = await db.query.projects.findMany({
      orderBy: desc(projects.createdAt),
      with: {
        collaborators: true,
      },
    });

    if (typeFilter) {
      allProjects = allProjects.filter((p) => p.projectType === typeFilter);
    }

    if (userId) {
      allProjects = allProjects.filter(
        (p) => p.userId === userId || p.collaborators.some((c) => c.userId === userId)
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

// 2. GET /api/projects/:id - Get project with all child stations, boreholes, and collaborators
router.get("/:id", async (req: Request, res: Response) => {
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

// 3. POST /api/projects - Create a new project
router.post("/", async (req: Request, res: Response) => {
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

// 4. PATCH /api/projects/:id - Update a project
router.patch("/:id", async (req: Request, res: Response) => {
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

// 5. POST /api/projects/:id/collaborators - Invite/Share project with a user
router.post("/:id/collaborators", async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid project ID" });
      return;
    }

    const validated = inviteCollaboratorSchema.parse(req.body);

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

// 6. DELETE /api/projects/:id - Delete project (cascades to all stations, boreholes, etc.)
router.delete("/:id", async (req: Request, res: Response) => {
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

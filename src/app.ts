import express from "express";
import Database from "better-sqlite3";
import { buildWhere } from "./utils/query-helper.js";
import { db } from "./data/db.js";
import { validateIdParam } from "./schemas/common.js";
import { parse } from "./schemas/validation.js";
import { AppError } from "./errors/app-error.js";
import { requireApiKey } from "./middlewares/require-api-key.js";
import { notFound } from "./middlewares/not-found.js";
import { errorHandler } from "./middlewares/error-handler.js";
import { fishSchema } from "./schemas/fish.schema.js";

const DB_FILE = process.env.DB_FILE || "recif.db";

export function createApp() {
  const app = express();
  app.use(express.json());

  // Tout paramètre :id est validé ici, une seule fois : 400 si invalide, sinon res.locals.id (number)
  app.param("id", validateIdParam);

  // ---------------------------------------------------------------- POISSONS

  // Liste des poissons, avec filtres ?species= et ?status=
  app.get("/fish", (req, res) => {
    const filters: any = {};
    if (req.query.species) filters.species = { op: "eq", value: req.query.species };
    if (req.query.status) filters.status = { op: "eq", value: req.query.status };
    const rows = db.prepare("SELECT * FROM fish " + buildWhere(filters) + " ORDER BY id").all();
    res.status(200).json(rows);
  });

  // Détail d'un poisson, avec ses demandes d'adoption
  app.get("/fish/:id", (req, res) => {
    const id = res.locals.id;
    const fish: any = db.prepare("SELECT * FROM fish WHERE id = ?").get(id);
    if (!fish) throw new AppError(404, "NOT_FOUND", `Fish ${id} introuvable`);
    fish.requests = db.prepare("SELECT * FROM adoption_requests WHERE fish_id = ?").all(id);
    res.status(200).json(fish);
  });

  // Ajout d'un poisson (équipe du Récif)
  app.post("/fish", requireApiKey, (req, res) => {
    const b = parse<Record<string, any>>(fishSchema, req.body);
    const info = db
      .prepare(
        "INSERT INTO fish (name, species, breed, birth_date, description, internal_notes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'disponible', ?)",
      )
      .run(b.name, b.species, b.breed || null, b.birthDate || null, b.description || "", b.internalNotes || "", new Date().toISOString());
    const fish = db.prepare("SELECT * FROM fish WHERE id = ?").get(info.lastInsertRowid);
    res.status(201).json(fish);
  });

  // Modification d'un poisson (équipe du Récif)
  app.put("/fish/:id", requireApiKey, (req, res) => {
    const id = res.locals.id;
    const data = parse<Record<string, unknown>>(fishSchema, req.body, { partial: true });
    const existing = db.prepare("SELECT * FROM fish WHERE id = ?").get(id);
    if (!existing) throw new AppError(404, "NOT_FOUND", `Fish ${id} introuvable`);
    // Seuls les champs validés par le schéma arrivent ici (jamais Object.keys(req.body))
    const fields = Object.keys(data);
    if (fields.length > 0) {
      const column = (f: string) => f.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
      const sets = fields.map((f) => column(f) + " = ?").join(", ");
      db.prepare("UPDATE fish SET " + sets + " WHERE id = ?").run(...fields.map((f) => data[f] as any), id);
    }
    const fish = db.prepare("SELECT * FROM fish WHERE id = ?").get(id);
    res.status(200).json(fish);
  });

  // Suppression d'un poisson (équipe du Récif)
  app.delete("/fish/:id", requireApiKey, (req, res) => {
    const id = res.locals.id;
    const fish = db.prepare("SELECT * FROM fish WHERE id = ?").get(id);
    if (!fish) throw new AppError(404, "NOT_FOUND", `Fish ${id} introuvable`);
    db.prepare("DELETE FROM adoption_requests WHERE fish_id = ?").run(id);
    db.prepare("DELETE FROM fish WHERE id = ?").run(id);
    res.status(204).end();
  });

  // ---------------------------------------------------------------- ADOPTIONS

  // Demande d'adoption (public)
  app.post("/fish/:id/adoptions", (req, res) => {
    const id = res.locals.id;
    const b = req.body;
    if (!b.adopterName || typeof b.adopterName !== "string" || b.adopterName.trim().length === 0 || b.adopterName.length > 80) {
      throw new AppError(400, "VALIDATION_ERROR", "Nom de l'adoptant invalide");
    }
    if (!b.adopterEmail || typeof b.adopterEmail !== "string" || b.adopterEmail.indexOf("@") === -1) {
      throw new AppError(400, "VALIDATION_ERROR", "Email invalide");
    }
    if (b.message && b.message.length > 500) {
      throw new AppError(400, "VALIDATION_ERROR", "Message trop long");
    }
    const fish: any = db.prepare("SELECT * FROM fish WHERE id = ?").get(id);
    if (!fish) throw new AppError(404, "NOT_FOUND", `Fish ${id} introuvable`);
    if (fish.status !== "disponible") {
      throw new AppError(409, "CONFLICT", "Ce poisson n'est plus disponible");
    }
    const info = db
      .prepare(
        "INSERT INTO adoption_requests (fish_id, adopter_name, adopter_email, message, status, created_at) VALUES (?, ?, ?, ?, 'en_attente', ?)",
      )
      .run(id, b.adopterName.trim(), b.adopterEmail, b.message || "", new Date().toISOString());
    db.prepare("UPDATE fish SET status = 'reserve' WHERE id = ?").run(id);
    const request = db.prepare("SELECT * FROM adoption_requests WHERE id = ?").get(info.lastInsertRowid);
    res.status(201).json(request);
  });

  // Liste des demandes (équipe du Récif), filtre ?status=
  app.get("/adoptions", requireApiKey, (req, res) => {
    const filters: any = {};
    if (req.query.status) filters.status = { op: "eq", value: req.query.status };
    const rows = db.prepare("SELECT * FROM adoption_requests " + buildWhere(filters) + " ORDER BY id").all();
    res.status(200).json(rows);
  });

  // Accepter / refuser une demande (équipe du Récif) : une seule logique, paramétrée par la décision
  function decide(decision: "acceptee" | "refusee"): express.RequestHandler {
    const fishStatus = decision === "acceptee" ? "adopte" : "disponible";
    return (_req, res) => {
      const id = res.locals.id;
      const request: any = db.prepare("SELECT * FROM adoption_requests WHERE id = ?").get(id);
      if (!request) throw new AppError(404, "NOT_FOUND", `Demande ${id} introuvable`);
      if (request.status !== "en_attente") throw new AppError(409, "CONFLICT", "Demande déjà traitée");
      db.prepare("UPDATE adoption_requests SET status = ?, decided_at = ? WHERE id = ?").run(decision, new Date().toISOString(), id);
      db.prepare("UPDATE fish SET status = ? WHERE id = ?").run(fishStatus, request.fish_id);
      const updated = db.prepare("SELECT * FROM adoption_requests WHERE id = ?").get(id);
      console.log("Demande " + id + " " + decision + ", il faudrait prévenir " + request.adopter_email);
      res.status(200).json(updated);
    };
  }

  app.post("/adoptions/:id/accept", requireApiKey, decide("acceptee"));
  app.post("/adoptions/:id/refuse", requireApiKey, decide("refusee"));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

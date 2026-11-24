import express from "express";
import Database from "better-sqlite3";
import { buildWhere } from "./utils/query-helper.js";
import { db } from "./data/db.js";
import { checkApiKey, validateIdParam } from "./schemas/common.js";
import { validate } from "./schemas/validation.js";
import { fishSchema } from "./schemas/fish.schema.js";

const DB_FILE = process.env.DB_FILE || "recif.db";

export function createApp() {
  const app = express();

  // Tout paramètre :id est validé ici, une seule fois : 400 si invalide, sinon res.locals.id (number)
  app.param("id", validateIdParam);

  // ---------------------------------------------------------------- POISSONS

  // Liste des poissons, avec filtres ?species= et ?status=
  app.get("/fish", (req, res) => {
    try {
      const filters: any = {};
      if (req.query.species) filters.species = { op: "eq", value: req.query.species };
      if (req.query.status) filters.status = { op: "eq", value: req.query.status };
      const rows = db.prepare("SELECT * FROM fish " + buildWhere(filters) + " ORDER BY id").all();
      res.status(200).json(rows);
    } catch (e) {
      console.log(e);
      res.status(500).send("Erreur");
    }
  });

  // Détail d'un poisson, avec ses demandes d'adoption
  app.get("/fish/:id", (req, res) => {
    const id = res.locals.id;
    const fish: any = db.prepare("SELECT * FROM fish WHERE id = ?").get(id);
    if (!fish) {
      res.status(404).send("Poisson introuvable");
      return;
    }
    fish.requests = db.prepare("SELECT * FROM adoption_requests WHERE fish_id = ?").all(id);
    res.status(200).json(fish);
  });

  // Ajout d'un poisson (équipe du Récif)
  app.post("/fish", checkApiKey, express.json(), (req, res) => {
    const result = validate<Record<string, any>>(fishSchema, req.body);
    if (!result.ok) {
      res.status(400).json({ errors: result.errors });
      return;
    }
    const b = result.data;
    const info = db
      .prepare(
        "INSERT INTO fish (name, species, breed, birth_date, description, internal_notes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'disponible', ?)",
      )
      .run(b.name, b.species, b.breed || null, b.birthDate || null, b.description || "", b.internalNotes || "", new Date().toISOString());
    const fish = db.prepare("SELECT * FROM fish WHERE id = ?").get(info.lastInsertRowid);
    res.status(201).json(fish);
  });

  // Modification d'un poisson (équipe du Récif)
  app.put("/fish/:id", checkApiKey, express.json(), (req, res) => {
    const id = res.locals.id;
    const result = validate<Record<string, unknown>>(fishSchema, req.body, { partial: true });
    if (!result.ok) {
      res.status(400).json({ errors: result.errors });
      return;
    }
    const existing = db.prepare("SELECT * FROM fish WHERE id = ?").get(id);
    if (!existing) {
      res.status(404).json({ error: "Poisson introuvable" });
      return;
    }
    // Seuls les champs validés par le schéma arrivent ici (jamais Object.keys(req.body))
    const fields = Object.keys(result.data);
    if (fields.length > 0) {
      const column = (f: string) => f.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
      const sets = fields.map((f) => column(f) + " = ?").join(", ");
      db.prepare("UPDATE fish SET " + sets + " WHERE id = ?").run(...fields.map((f) => result.data[f] as any), id);
    }
    const fish = db.prepare("SELECT * FROM fish WHERE id = ?").get(id);
    res.status(200).json(fish);
  });

  // Suppression d'un poisson (équipe du Récif)
  app.delete("/fish/:id", checkApiKey, (req, res) => {
    const id = res.locals.id;
    const fish = db.prepare("SELECT * FROM fish WHERE id = ?").get(id);
    if (!fish) {
      res.status(404).json({ message: "Poisson introuvable" });
      return;
    }
    db.prepare("DELETE FROM adoption_requests WHERE fish_id = ?").run(id);
    db.prepare("DELETE FROM fish WHERE id = ?").run(id);
    res.status(204).end();
  });

  // ---------------------------------------------------------------- ADOPTIONS

  // Demande d'adoption (public)
  app.post("/fish/:id/adoptions", express.json(), (req, res) => {
    const id = res.locals.id;
    const b = req.body;
    if (!b.adopterName || typeof b.adopterName !== "string" || b.adopterName.trim().length === 0 || b.adopterName.length > 80) {
      res.status(400).json({ message: "Nom de l'adoptant invalide" });
      return;
    }
    if (!b.adopterEmail || typeof b.adopterEmail !== "string" || b.adopterEmail.indexOf("@") === -1) {
      res.status(400).json({ message: "Email invalide" });
      return;
    }
    if (b.message && b.message.length > 500) {
      res.status(400).json({ message: "Message trop long" });
      return;
    }
    const fish: any = db.prepare("SELECT * FROM fish WHERE id = ?").get(id);
    if (!fish) {
      res.status(404).json({ message: "Poisson introuvable" });
      return;
    }
    if (fish.status !== "disponible") {
      res.status(409).json({ error: "Ce poisson n'est plus disponible" });
      return;
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
  app.get("/adoptions", checkApiKey, (req, res) => {
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
      if (!request) {
        res.status(404).json({ message: "Demande introuvable" });
        return;
      }
      if (request.status !== "en_attente") {
        res.status(409).json({ message: "Demande déjà traitée" });
        return;
      }
      db.prepare("UPDATE adoption_requests SET status = ?, decided_at = ? WHERE id = ?").run(decision, new Date().toISOString(), id);
      db.prepare("UPDATE fish SET status = ? WHERE id = ?").run(fishStatus, request.fish_id);
      const updated = db.prepare("SELECT * FROM adoption_requests WHERE id = ?").get(id);
      console.log("Demande " + id + " " + decision + ", il faudrait prévenir " + request.adopter_email);
      res.status(200).json(updated);
    };
  }

  app.post("/adoptions/:id/accept", checkApiKey, decide("acceptee"));
  app.post("/adoptions/:id/refuse", checkApiKey, decide("refusee"));

  return app;
}

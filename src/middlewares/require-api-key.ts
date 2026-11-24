import type { RequestHandler } from "express";
import { config } from "../config.js";
import { AppError } from "../errors/app-error.js";

// La seule comparaison de la clé d'API de toute l'application
export const requireApiKey: RequestHandler = (req, _res, next) => {
  if (req.get("X-Api-Key") !== config.adminApiKey) {
    throw new AppError(401, "UNAUTHORIZED", "Clé API manquante ou invalide");
  }
  next();
};

import type { ErrorRequestHandler } from "express";
import { AppError } from "../errors/app-error.js";

// 4 paramètres : c'est ce qui permet à Express de reconnaître un gestionnaire d'erreurs
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "INVALID_JSON", message: "Corps JSON mal formé" } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: "INTERNAL", message: "Erreur interne du serveur" } });
};

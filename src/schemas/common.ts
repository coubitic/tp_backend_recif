import type { RequestParamHandler } from "express";
import { AppError } from "../errors/app-error.js";

// Renvoie l'identifiant, ou lève une AppError 400 s'il est invalide ("abc", "0", "1.5", "12abc", "")
export function parseId(raw: unknown): number {
    if (typeof raw === "string" && /^\d+$/.test(raw)) {
        const id = Number(raw);
        if (Number.isSafeInteger(id) && id > 0) return id;
    }
    throw new AppError(400, "VALIDATION_ERROR", "Identifiant invalide");
}

// Middleware : à brancher avec app.param("id", validateIdParam) pour couvrir toutes les routes /:id
export const validateIdParam: RequestParamHandler = (_req, res, next, raw) => {
    res.locals.id = parseId(raw);
    next();
};

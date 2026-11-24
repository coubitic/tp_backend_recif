import type { RequestHandler, RequestParamHandler } from "express";
import { config } from "../config.js";

// Renvoie l'identifiant, ou null s'il est invalide ("abc", "0", "1.5", "12abc", "")
export function parseId(raw: unknown): number | null {
    if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
    const id = Number(raw);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Middleware : à brancher avec app.param("id", validateIdParam) pour couvrir toutes les routes /:id
export const validateIdParam: RequestParamHandler = (_req, res, next, raw) => {
    const id = parseId(raw);
    if (id === null) {
        res.status(400).json({ error: "Identifiant invalide" });
        return;
    }
    res.locals.id = id;
    next();
};

// Middleware : la seule comparaison de la clé d'API de toute l'application
export const checkApiKey: RequestHandler = (req, res, next) => {
    if (req.get("X-Api-Key") !== config.adminApiKey) {
        res.status(401).json({ error: "Clé API manquante ou invalide" });
        return;
    }
    next();
};

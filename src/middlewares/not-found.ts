import type { RequestHandler } from "express";
import { AppError } from "../errors/app-error.js";

export const notFound: RequestHandler = (req, _res, next) => {
  next(new AppError(404, "NOT_FOUND", `Route introuvable : ${req.method} ${req.path}`));
};

import { AppError } from "../errors/app-error.js";

export type Rule = (value: unknown) => string | null;
export type Schema = Record<string, Rule>;

export const text = (min: number, max: number): Rule => (value) =>
    typeof value === "string" && value.trim().length >= min && value.trim().length <= max
        ? null
        : `texte de ${min} à ${max} caractères attendu`;

export const oneOf = (values: readonly string[]): Rule => (value) =>
    typeof value === "string" && values.includes(value) ? null : "valeur inconnue";

// Champ facultatif : absent ou null, il est accepté ; présent, il doit respecter la règle
export const optional = (rule: Rule): Rule => (value) =>
    value === undefined || value === null ? null : rule(value);

// À vous : email (une regex simple suffit) et isoDate (AAAA-MM-JJ, date qui existe)
export const email: Rule = (value) =>
    typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : "email invalide";

export const isoDate: Rule = (value) => {
    if (typeof value !== "string") return "date au format AAAA-MM-JJ attendue";
    const date = new Date(value);
    return !isNaN(date.getTime()) && /^\d{4}-\d{2}-\d{2}$/.test(value) ? null : "date au format AAAA-MM-JJ attendue";
};


export type ValidationResult<T> = { ok: true; data: T } | { ok: false; errors: string[] };

export function validate<T = Record<string, any>>(
    schema: Schema,
    input: unknown,
    options: { partial?: boolean } = {},   // partial : pour une modification
): ValidationResult<T> {
    // Pour chaque champ du schéma :
    //  - absent et options.partial → on l'ignore ;
    //  - sinon on applique la règle : un message → on l'ajoute aux erreurs ;
    //  - valide → on le recopie dans data (texte nettoyé avec trim()).
    // Les champs qui ne sont PAS dans le schéma ne sont jamais recopiés.
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return { ok: false, errors: ["corps de la requête invalide"] };
    }
    const body = input as Record<string, unknown>;
    const errors: string[] = [];
    const data: Record<string, unknown> = {};

    for (const [field, rule] of Object.entries(schema)) {
        const value = body[field];
        if (value === undefined && options.partial) continue;

        const message = rule(value);
        if (message) {
            errors.push(`${field} : ${message}`);
        } else if (value !== undefined) {
            data[field] = typeof value === "string" ? value.trim() : value;
        }
    }

    return errors.length > 0 ? { ok: false, errors } : { ok: true, data: data as T };
}


// Valide et renvoie les données, ou lève une AppError 400 VALIDATION_ERROR
export function parse<T = Record<string, any>>(schema: Schema, input: unknown, options: { partial?: boolean } = {}): T {
    const result = validate<T>(schema, input, options);
    if (!result.ok) throw new AppError(400, "VALIDATION_ERROR", result.errors.join(" ; "));
    return result.data;
}

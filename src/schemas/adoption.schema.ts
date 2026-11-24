import { Schema, text, email } from "./validation.js";

export const adoptionRequestSchema: Schema = { 
    name: text(1, 80), 
    email: email,
    description: text(0, 500)
}
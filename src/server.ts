import { createApp } from "./app.js";
import { config } from "./config.js";

const port = Number(config.port ?? 3000);
createApp().listen(port, () => {
  console.log(`Le Récif API sur http://localhost:${port}`);
});

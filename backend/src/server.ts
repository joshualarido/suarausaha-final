import { env } from "./config/env.js";
import { app } from "./app.js";
import { ensureDatabaseSchema } from "./lib/database.js";

async function bootstrap(): Promise<void> {
  await ensureDatabaseSchema();

  app.listen(env.PORT, () => {
    console.log(`SuaraUsaha backend listening on http://localhost:${env.PORT}`);
  });
}

void bootstrap();

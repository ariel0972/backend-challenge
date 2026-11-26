/* eslint-disable prettier/prettier */
import { defineConfig } from "@mikro-orm/postgresql";
import { Migrator } from "@mikro-orm/migrations";
import { WalletSchema } from "./infrastructure/database/wallet.entity";

export default defineConfig({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? "5000"),
  dbName: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,

  entities: [WalletSchema],
  extensions: [Migrator],

  migrations: {
    path: "./dist/infrastructure/database/migrations",
    pathTs: "./src/infrastructure/database/migrations",
  },
});
